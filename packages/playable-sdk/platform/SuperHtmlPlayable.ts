export class SuperHtmlPlayable {
  private googlePlayUrl = '';
  private appStoreUrl = '';

  download(): void {
    (globalThis as any).super_html?.download?.();
  }

  game_end(): void {
    (globalThis as any).super_html?.game_end?.();
  }

  is_hide_download(): boolean {
    return !!(globalThis as any).super_html?.is_hide_download?.();
  }

  set_google_play_url(url: string): void {
    this.googlePlayUrl = url;
    const superHtml = (globalThis as any).super_html;
    if (superHtml) superHtml.google_play_url = url;
  }

  set_app_store_url(url: string): void {
    this.appStoreUrl = url;
    const superHtml = (globalThis as any).super_html;
    if (superHtml) superHtml.appstore_url = url;
  }

  get_download_url(): string {
    const isIOS =
      typeof navigator !== 'undefined' &&
      /iPad|iPhone|iPod/i.test(navigator.userAgent);

    return isIOS
      ? this.appStoreUrl || this.googlePlayUrl
      : this.googlePlayUrl || this.appStoreUrl;
  }

  is_audio(): boolean {
    const superHtml = (globalThis as any).super_html;
    return superHtml?.is_audio?.() ?? true;
  }
}

export const superHtmlPlayable = new SuperHtmlPlayable();
export default superHtmlPlayable;
