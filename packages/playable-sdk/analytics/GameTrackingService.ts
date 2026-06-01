import { assetManager, JsonAsset, resources } from "cc";
import ga from "gameanalytics";

type TrackingConfig = {
    project_id: string;
    brief_id: string;
    android_bundle_id: string;
    ios_bundle_id: string;
    gameAnalytics: {
        gameKey: string;
        gameSecret: string;
        build: string;
        verboseLog: boolean;
    };
    events: Record<string, string>;
    batch: {
        max_events: number;
        flush_interval_seconds: number;
    };
    offline: {
        storage_key: string;
        max_events: number;
    };
    engagement: {
        target_duration: number;
        heartbeat_interval: number;
    };
    interactions: {
        target_clicks: number;
    };
};

type TrackingEvent = {
    key: string;
    name: string;
    params: Record<string, string | number>;
};

type AppLovinPlayableEvent =
    | "DISPLAYED"
    | "CHALLENGE_STARTED"
    | "CHALLENGE_PASS_25"
    | "CHALLENGE_PASS_50"
    | "CHALLENGE_PASS_75"
    | "CHALLENGE_FAILED"
    | "CHALLENGE_SOLVED"
    | "CTA_CLICKED";

type AppLovinPlayableAnalytics = {
    trackEvent(eventName: AppLovinPlayableEvent): void;
};

declare global {
    interface Window {
        ALPlayableAnalytics?: AppLovinPlayableAnalytics;
        super_html_channel?: string;
    }
}

const DEFAULT_CONFIG: TrackingConfig = {
    project_id: "unknown_project",
    brief_id: "unknown_brief",
    android_bundle_id: "unknown_android_bundle",
    ios_bundle_id: "unknown_ios_bundle",
    gameAnalytics: {
        gameKey: "",
        gameSecret: "",
        build: "1.0.0",
        verboseLog: true
    },
    events: {},
    batch: {
        max_events: 5,
        flush_interval_seconds: 3
    },
    offline: {
        storage_key: "game_tracking_offline_events",
        max_events: 100
    },
    engagement: {
        target_duration: 30,
        heartbeat_interval: 5
    },
    interactions: {
        target_clicks: 4
    }
};

export class GameTrackingService {
    private static readonly CONFIG_PATH: string = "TrackingConfig";
    private static configBundles: string[] = ["resources"];
    private static config: TrackingConfig = DEFAULT_CONFIG;
    private static defaultParams: Record<string, string> = {
        project_id: DEFAULT_CONFIG.project_id,
        brief_id: DEFAULT_CONFIG.brief_id,
        playable_id: `${DEFAULT_CONFIG.android_bundle_id}.playable`
    };
    private static ready: boolean = false;
    private static initPromise: Promise<TrackingConfig> = null;
    private static queue: (() => void)[] = [];
    private static batch: TrackingEvent[] = [];
    private static batchTimer: any = null;
    private static heartbeatTimer: any = null;
    private static sessionStartedAt: number = 0;
    private static sessionTime: number = 0;
    private static sessionActive: boolean = false;
    private static targetDurationReached: boolean = false;
    private static gameEnded: boolean = false;
    private static step: number = 0;
    private static onlineListenerAdded: boolean = false;
    private static useAppLovinAnalytics: boolean = false;
    private static appLovinSentEvents: Set<AppLovinPlayableEvent> = new Set();
    private static appLovinChallengeStartedAt: number = 0;

    public static init(bundles?: string[]): Promise<TrackingConfig> {
        if (bundles) this.configBundles = bundles;
        if (this.ready) return Promise.resolve(this.config);
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.loadConfig().then((config) => {
            this.config = config;
            this.defaultParams = this.buildDefaultParams();
            this.useAppLovinAnalytics = this.isAppLovinEnvironment();
            if (!this.useAppLovinAnalytics) {
                this.initGameAnalytics();
                this.listenOnline();
                this.flushCachedEvents();
            }
            this.ready = true;
            this.logEvent("playableLoaded");
            this.startSession();
            this.queue.splice(0).forEach(fn => fn());
            this.initPromise = null;
            return config;
        });

        return this.initPromise;
    }

    public static startSession(): void {
        this.run(() => {
            if (this.sessionActive || this.gameEnded) return;
            this.sessionActive = true;
            this.sessionStartedAt = Date.now();
            this.sessionTime = 0;
            this.targetDurationReached = false;
            this.logEvent("sessionStart");
            this.heartbeatTimer = setInterval(() => {
                this.sessionTime = this.elapsedTime();
                this.logEvent("sessionStay", { seconds: this.sessionTime });
                if (!this.targetDurationReached && this.sessionTime >= this.config.engagement.target_duration) {
                    this.targetDurationReached = true;
                    this.logEvent("targetDurationReached", { target: this.config.engagement.target_duration });
                }
            }, this.config.engagement.heartbeat_interval * 1000);
        });
    }

    public static stopSession(): void {
        this.run(() => {
            if (!this.sessionActive) {
                this.flushBatch();
                return;
            }
            if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
            this.sessionActive = false;
            this.sessionTime = this.elapsedTime();
            this.logEvent("sessionEnd", { total_time: this.sessionTime });
            this.flushBatch();
        });
    }

    public static logInteraction(params?: Record<string, any>): void {
        this.run(() => {
            if (this.gameEnded) return;
            if (!this.sessionActive) this.startSession();
            const requestedStep = typeof params?.step === "number" ? params.step : this.step + 1;
            this.step = Math.max(this.step, requestedStep);
            this.logEvent("interactionStep", { ...params, step: requestedStep });
            if (this.step === this.config.interactions.target_clicks) {
                this.logEvent("targetClicksReached", { ...params, total_clicks: this.step });
            }
        });
    }

    public static logDownloadClick(params?: Record<string, any>): void {
        this.run(() => {
            this.logEvent("playableClicked", params);
            this.stopSession();
            this.flushBatch();
        });
    }

    public static logGameWin(params?: Record<string, any>): void {
        this.logGameEnd("win", params);
    }

    public static logGameLose(params?: Record<string, any>): void {
        this.logGameEnd("lose", params);
    }

    public static logEvent(eventKey: string, params?: Record<string, any>): void {
        this.run(() => this.addToBatch(eventKey, params));
    }

    public static flushEvents(): void {
        this.run(() => this.flushBatch());
    }

    private static logGameEnd(result: string, params?: Record<string, any>): void {
        this.run(() => {
            if (this.gameEnded) return;
            this.gameEnded = true;
            this.logEvent("gameEnd", { ...params, result });
            this.stopSession();
            this.flushBatch();
        });
    }

    private static run(fn: () => void): void {
        if (this.ready) fn();
        else {
            this.queue.push(fn);
            this.init().catch(() => undefined);
        }
    }

    private static initGameAnalytics(): void {
        ga.GameAnalytics.setEnabledVerboseLog(this.config.gameAnalytics.verboseLog);
        ga.GameAnalytics.setEventProcessInterval(this.config.batch.flush_interval_seconds);
        ga.GameAnalytics.configureBuild(this.config.gameAnalytics.build);
        ga.GameAnalytics.initialize(this.config.gameAnalytics.gameKey, this.config.gameAnalytics.gameSecret);
    }

    private static isAppLovinEnvironment(): boolean {
        if (typeof window === "undefined") return false;

        const channel = `${window.super_html_channel || ""}`.toLowerCase();
        return channel === "applovin" || typeof window.ALPlayableAnalytics !== "undefined";
    }

    private static loadConfig(): Promise<TrackingConfig> {
        return this.loadConfigJson().then(json => ({
            project_id: json?.project_id || DEFAULT_CONFIG.project_id,
            brief_id: json?.brief_id || DEFAULT_CONFIG.brief_id,
            android_bundle_id: json?.android_bundle_id || DEFAULT_CONFIG.android_bundle_id,
            ios_bundle_id: json?.ios_bundle_id || DEFAULT_CONFIG.ios_bundle_id,
            gameAnalytics: { ...DEFAULT_CONFIG.gameAnalytics, ...json?.gameAnalytics },
            events: { ...DEFAULT_CONFIG.events, ...json?.events },
            batch: { ...DEFAULT_CONFIG.batch, ...json?.batch },
            offline: { ...DEFAULT_CONFIG.offline, ...json?.offline },
            engagement: { ...DEFAULT_CONFIG.engagement, ...json?.engagement },
            interactions: { ...DEFAULT_CONFIG.interactions, ...json?.interactions }
        }));
    }

    private static loadConfigJson(): Promise<Partial<TrackingConfig>> {
        return new Promise(resolve => this.loadConfigFromBundle(0, resolve));
    }

    private static loadConfigFromBundle(index: number, resolve: (json: Partial<TrackingConfig>) => void): void {
        const bundleName = this.configBundles[index];
        if (!bundleName) {
            resolve({});
            return;
        }

        const onLoaded = (asset?: JsonAsset | null) => {
            if (asset?.json) resolve(asset.json as Partial<TrackingConfig>);
            else this.loadConfigFromBundle(index + 1, resolve);
        };

        if (bundleName === "resources") {
            resources.load(this.CONFIG_PATH, JsonAsset, (_, asset) => onLoaded(asset));
            return;
        }

        const bundle = assetManager.getBundle(bundleName);
        if (bundle) {
            bundle.load(this.CONFIG_PATH, JsonAsset, (_, asset) => onLoaded(asset));
            return;
        }

        assetManager.loadBundle(bundleName, (_, loadedBundle) => {
            if (!loadedBundle) {
                this.loadConfigFromBundle(index + 1, resolve);
                return;
            }
            loadedBundle.load(this.CONFIG_PATH, JsonAsset, (_, asset) => onLoaded(asset));
        });
    }

    private static fill(value: string, data: Record<string, any>): string {
        Object.keys(data).forEach(key => value = value.replace(`{${key}}`, `${data[key]}`));
        return value;
    }

    private static eventName(key: string, params?: Record<string, any>): string {
        return this.fill(this.config.events[key] ?? key, params ?? {});
    }

    private static addToBatch(eventKey: string, params?: Record<string, any>): void {
        const eventParams = this.withDefaultParams(params);
        const event: TrackingEvent = {
            key: eventKey,
            name: this.eventName(eventKey, eventParams),
            params: this.clean(eventParams)
        };

        if (this.useAppLovinAnalytics) {
            this.sendEvent(event);
            return;
        }

        this.batch.push(event);

        if (this.batch.length >= this.config.batch.max_events) this.flushBatch();
        else this.scheduleBatchFlush();
    }

    private static withDefaultParams(params?: Record<string, any>): Record<string, any> {
        return {
            ...(params ?? {}),
            ...this.defaultParams
        };
    }

    private static buildDefaultParams(): Record<string, string> {
        return {
            project_id: this.snakeCaseValue(this.config.project_id || DEFAULT_CONFIG.project_id),
            brief_id: this.snakeCaseValue(this.config.brief_id || DEFAULT_CONFIG.brief_id),
            playable_id: this.buildPlayableId()
        };
    }

    private static buildPlayableId(): string {
        const bundleId = this.isAppleEnvironment()
            ? this.config.ios_bundle_id || DEFAULT_CONFIG.ios_bundle_id
            : this.config.android_bundle_id || DEFAULT_CONFIG.android_bundle_id;

        return `${bundleId}.playable`;
    }

    private static isAppleEnvironment(): boolean {
        if (typeof navigator === "undefined") return false;

        const userAgent = navigator.userAgent || "";
        const vendor = navigator.vendor || "";
        const platform = navigator.platform || "";
        const maxTouchPoints = navigator.maxTouchPoints || 0;
        const isApplePlatform = /iPad|iPhone|iPod|Mac/i.test(platform)
            || /iPad|iPhone|iPod|Macintosh/i.test(userAgent)
            || (/MacIntel/i.test(platform) && maxTouchPoints > 1);
        const isSafari = /Safari/i.test(userAgent)
            && /Apple/i.test(vendor)
            && !/Chrome|CriOS|FxiOS|Edg|OPR|SamsungBrowser/i.test(userAgent);

        return isApplePlatform || isSafari;
    }

    private static snakeCaseValue(value: string): string {
        return `${value}`
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
            .replace(/[^a-zA-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .replace(/_+/g, "_")
            .toLowerCase();
    }

    private static scheduleBatchFlush(): void {
        if (this.batchTimer) return;
        this.batchTimer = setTimeout(() => this.flushBatch(), this.config.batch.flush_interval_seconds * 1000);
    }

    private static flushBatch(): void {
        if (this.batchTimer) clearTimeout(this.batchTimer);
        this.batchTimer = null;
        const events = this.batch.splice(0);
        if (!this.isOnline()) {
            this.cacheEvents(events);
            return;
        }
        this.flushCachedEvents();
        events.forEach(event => this.sendEvent(event));
    }

    private static sendEvent(event: TrackingEvent): void {
        if (this.useAppLovinAnalytics) {
            this.sendAppLovinEvent(event);
            return;
        }

        ga.GameAnalytics.addDesignEvent(event.name, null, event.params);
    }

    private static sendAppLovinEvent(event: TrackingEvent): void {
        const analytics = typeof window !== "undefined" ? window.ALPlayableAnalytics : undefined;
        if (!analytics) return;

        this.appLovinEventNames(event).forEach(eventName => {
            if (this.appLovinSentEvents.has(eventName)) return;

            analytics.trackEvent(eventName);
            this.appLovinSentEvents.add(eventName);
            if (eventName === "CHALLENGE_STARTED") {
                this.appLovinChallengeStartedAt = Date.now();
            }
        });
    }

    private static appLovinEventNames(event: TrackingEvent): AppLovinPlayableEvent[] {
        switch (event.key) {
            case "playableLoaded":
                return ["DISPLAYED"];
            case "interactionStep":
                return ["CHALLENGE_STARTED"];
            case "sessionStay":
                return this.appLovinDurationEvents();
            case "sessionEnd":
                return this.appLovinDurationEvents();
            case "playableClicked":
                return [...this.appLovinDurationEvents(), "CTA_CLICKED"];
            case "gameEnd":
                return [
                    ...this.appLovinDurationEvents(),
                    event.params.result === "win" ? "CHALLENGE_SOLVED" : "CHALLENGE_FAILED"
                ];
            default:
                return [];
        }
    }

    private static appLovinDurationEvents(): AppLovinPlayableEvent[] {
        const targetDuration = this.config.engagement.target_duration;
        if (!this.appLovinChallengeStartedAt || targetDuration <= 0) return [];

        const elapsedSeconds = Math.max(0, (Date.now() - this.appLovinChallengeStartedAt) / 1000);
        const progress = elapsedSeconds / targetDuration;
        const eventNames: AppLovinPlayableEvent[] = [];
        if (progress >= 0.25) eventNames.push("CHALLENGE_PASS_25");
        if (progress >= 0.5) eventNames.push("CHALLENGE_PASS_50");
        if (progress >= 0.75) eventNames.push("CHALLENGE_PASS_75");
        return eventNames;
    }

    private static listenOnline(): void {
        if (this.onlineListenerAdded || typeof window === "undefined") return;
        this.onlineListenerAdded = true;
        window.addEventListener("online", () => this.flushEvents());
    }

    private static isOnline(): boolean {
        return typeof navigator === "undefined" || navigator.onLine !== false;
    }

    private static cacheEvents(events: TrackingEvent[]): void {
        if (!events.length || typeof localStorage === "undefined") return;
        const cached = this.cachedEvents().concat(events).slice(-this.config.offline.max_events);
        localStorage.setItem(this.config.offline.storage_key, JSON.stringify(cached));
    }

    private static flushCachedEvents(): void {
        if (!this.isOnline() || typeof localStorage === "undefined") return;
        const cached = this.cachedEvents();
        localStorage.removeItem(this.config.offline.storage_key);
        cached.forEach(event => this.sendEvent(event));
    }

    private static cachedEvents(): TrackingEvent[] {
        return JSON.parse(localStorage.getItem(this.config.offline.storage_key) || "[]") as TrackingEvent[];
    }

    private static elapsedTime(): number {
        return Math.max(0, Math.round((Date.now() - this.sessionStartedAt) / 1000));
    }

    private static clean(params?: Record<string, any>): Record<string, string | number> {
        const result: Record<string, string | number> = {};
        const source = params ?? {};
        Object.keys(source).slice(0, 50).forEach(key => {
            const value = source[key];
            if (value === null || value === undefined || value === "") return;
            const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
            result[cleanKey] = typeof value === "number" && value !== 0 ? value : `${value}`.slice(0, 256);
        });
        return result;
    }
}
