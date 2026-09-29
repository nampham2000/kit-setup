import { CCObject, Director, Node, director } from 'cc';
import { DEBUG, EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { SceneViewDebug } from './SceneViewDebug';

const NODE_NAME = '__SceneView__';

/**
 * Installs the scene view into every scene on its own, so dropping this folder
 * into a project is the whole setup — no node to create, no component to drag.
 *
 * **Delete this one file to turn auto-install off** and go back to attaching
 * `SceneViewDebug` by hand, which is what you want as soon as you need to change
 * its properties in the Inspector.
 *
 * This runs as a module side effect. Cocos bundles and evaluates every script
 * under `assets`, which is also how `@ccclass` registration happens, so the
 * listener below is registered without anything importing this file.
 */
function install () {
    const scene = director.getScene();
    if (!scene) return;

    // A hand-placed component wins: it carries Inspector settings this one cannot.
    if (scene.getComponentInChildren(SceneViewDebug)) return;

    const node = new Node(NODE_NAME);
    node.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
    scene.addChild(node);
    node.addComponent(SceneViewDebug);
}

// EDITOR_NOT_IN_PREVIEW, not EDITOR: the editor Preview panel reports EDITOR true
// and is exactly where this should run. DEBUG keeps it out of release builds.
if (!EDITOR_NOT_IN_PREVIEW && DEBUG) {
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, install);

    // In a build, scripts are evaluated before the launch scene runs, so the event
    // above is enough. The editor Preview runs the scene that is already open, and
    // can evaluate this module after that scene has launched — the event would then
    // never fire until the next scene change. Catching up on the following frame
    // covers it, and `install` is idempotent so a doubled call costs nothing.
    if (director.getScene()) director.once(Director.EVENT_BEFORE_UPDATE, install);
}
