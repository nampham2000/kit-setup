/**
 * Every explanation the tool shows on hover, in one place so the wording can be read and
 * changed without touching the code that uses it.
 *
 * Each text is a heading, a line break, then a sentence or two. A text without a line
 * break shows as a single plain line.
 */

/** The switches in the help panel, by their label. */
export const TOGGLE_TIPS: Record<string, string> = {
    'Game UI': 'Game UI\nDraw the game\'s own 2D interface (menus, buttons, HUD) in the scene view too. Turn it off if clicking in the scene view reaches the game\'s buttons.',
    'Follow Hierarchy selection': 'Follow selection\nWhen you pick a node in the Hierarchy, the scene camera flies to it.',
    'Hierarchy and Inspector': 'Side panels\nShow or hide the Hierarchy on the left and the Inspector on the right.',
    Console: 'Console\nShow the page\'s log (messages, warnings, errors) in a drawer at the bottom, so you do not need to open F12.',
    Grid: 'Grid\nThe grid on the ground, for judging positions and sizes.',
    'Bounding boxes': 'Bounding boxes\nDraw a box around each mesh to show how much room it takes.',
    'Selected camera frustum': 'Camera frustum\nWhen a camera is selected, draw the volume it can see, so you know what the player would see.',
    'Collider shapes': 'Collider shapes\nDraw the selected node\'s colliders as a green wireframe. Edit them in the Inspector or with the Collider tool (5).',
    'All colliders': 'All colliders\nDraw the colliders of every node in the scene, in a dimmer green. A big level can fill the view with lines.',
    'World axes': 'World axes\nThe lines through the origin of the scene: X red, Y green, Z blue.',
    'Debug logging': 'Debug logging\nPrint every click and what it hit to the Console. Use it to find out why something could not be picked.',
};

/** The Inspector's transform fields, by name. */
export const TRANSFORM_TIPS: Record<string, string> = {
    position: 'Position\nWhere the node is, relative to its parent. The scene follows as you type.',
    rotation: 'Rotation\nHow the node is turned, as X, Y and Z angles in degrees, relative to its parent.',
    scale: 'Scale\nHow much bigger or smaller the node is on each axis. 1 is normal size. A collider on it is scaled too.',
};

export const NODE_TIPS = {
    active: 'Active\nWhen off, the node and everything under it is disabled: it disappears and stops updating.',
    name: 'Name\nThe selected node\'s name.',
    path: 'Path\nThe node\'s parents, from the scene down to it.',
    meta: 'World position, layer, children\nWhere the node really is after its parents\' transforms (read only), the render layer it is on, and how many child nodes it has.',
    components: 'Components\nEverything attached to this node.',
};

/** The fields of a collider block in the Inspector, by label. */
export const COLLIDER_TIPS: Record<string, string> = {
    center: 'Center\nWhere the middle of the shape is, measured from the node\'s own origin.',
    size: 'Size\nWidth, height and depth of the box. It is multiplied by the node\'s scale.',
    radius: 'Radius\nHow wide the sphere or capsule is.',
    height: 'Height\nLength of the straight part of the capsule, between its two rounded ends.',
    direction: 'Direction\nWhich axis the capsule is long along.',
    trigger: 'Trigger\nA trigger does not block other bodies. It only reports when something passes into it.',
    enabled: 'Enabled\nA disabled collider takes no part in the physics.',
};

export const COLLIDER_HEAD_TIP = 'Collider\nA shape the physics engine uses for this node. The green wireframe in the scene view shows it. Edit the numbers, or press 5 and drag its handles.';

/** Hierarchy rows. */
export const HIERARCHY_TIPS = {
    caret: 'Expand / collapse\nShow or hide this node\'s children.',
    children: 'Children\nHow many direct child nodes this node has.',
    prefab: 'Prefab\nThis node belongs to a prefab. Prefab nodes are green, as in the editor.',
    hide: 'Hide / show\nSwitch this node\'s renderers off or on. Both views draw the same scene, so the game view loses it too. Scripts and physics keep running.',
    solo: 'Solo\nShow only this node and its children, and switch every other renderer off (in the game view too). Press again to bring everything back.',
    kind: 'The coloured square shows what kind of node this is: yellow camera, orange light, blue UI, green model, solid grey group, outlined grey empty.',
};

/** Console. */
export const CONSOLE_TIPS = {
    button: 'Console (L)\nThe page\'s log. The red and yellow numbers count the errors and warnings so far.',
    log: 'Log\nShow or hide ordinary messages (console.log, info, debug).',
    warn: 'Warn\nShow or hide warnings.',
    error: 'Error\nShow or hide errors, including uncaught errors and failed promises.',
    time: 'Time\nWhen this message was logged: hours, minutes, seconds, milliseconds.',
    repeated: (n: number) => `Repeated\nThis exact message was logged ${n} times in a row.`,
};

/** The tool strip in the scene view, drawn by the engine, by tool. */
export const TOOL_TIPS: Record<string, string> = {
    move: 'Move tool (1)\nDrag an arrow to move the selected node along that axis. Red is X, green is Y, blue is Z.',
    rotate: 'Rotate tool (2)\nDrag a ring to turn the selected node around that axis.',
    scale: 'Scale tool (3)\nDrag a handle to stretch the selected node along that axis.',
    view: 'No gizmo (4)\nHide the handles, so a click only selects and cannot grab anything by accident.',
    collider: 'Collider tool (5)\nShows handles on the selected node\'s collider. Drag one to resize the shape; the opposite side stays where it is.',
};

export const SPLITTER_TIP = 'Divider\nDrag it left or right to change how much room the game and the scene view get.';
export const HANDLE_TIP = 'Collider handle\nDrag to resize the shape. The opposite side stays where it is.';
export const STATUS_TIP = 'Current tool and selection\nThe tool you are using and the node that is selected.';
export const TEXT_SIZE_TIP = 'Text size\nMake the text in every panel smaller or larger. The keys [ and ] do the same. It is remembered.';
