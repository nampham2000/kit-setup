import { Node } from 'cc';
import { MenuItem } from './ContextMenu';
import { NODE_KINDS, NodeKind } from './NodeFactory';

/** The submenu title for each group of NODE_KINDS. The ungrouped 'Node' kinds sit directly in the menu. */
const GROUP_TITLES: Record<string, string> = {
    '3D object': '3D Object',
    Light: 'Light',
    UI: 'UI Component',
};

/**
 * The entries of "Create", laid out like the editor's: Empty Node on top, then a submenu per kind
 * of thing. Built from NODE_KINDS, so a new kind added there shows up here without a change.
 */
export function createItems (onCreate: (kind: NodeKind) => void): MenuItem[] {
    const items: MenuItem[] = [];
    const groups = new Map<string, MenuItem>();

    for (const info of NODE_KINDS) {
        const leaf: MenuItem = { label: info.label, run: () => onCreate(info.kind) };
        if (info.group === 'Node') {
            items.push(leaf);
            continue;
        }
        let group = groups.get(info.group);
        if (!group) {
            group = { label: GROUP_TITLES[info.group] || info.group, children: [] };
            groups.set(info.group, group);
            items.push(group);
        }
        group.children.push(leaf);
    }
    return items;
}

export interface NodeMenuActions {
    create: (kind: NodeKind) => void;
    copy: () => void;
    paste: () => void;
    duplicate: () => void;
    remove: () => void;
    copyUuid: () => void;
    copyPath: () => void;
}

export interface NodeMenuState {
    /** A node was right-clicked, as opposed to the empty part of the list. */
    hasNode: boolean;
    /** The node may be copied, duplicated or deleted (it is not the scene or this tool's own camera). */
    canEdit: boolean;
    /** Something has been copied and is still there to paste. */
    canPaste: boolean;
}

/** The right-click menu of a Hierarchy row, or of its empty area when no node is under the pointer. */
export function nodeMenuItems (actions: NodeMenuActions, state: NodeMenuState): MenuItem[] {
    return [
        { label: 'Create', children: createItems(actions.create) },
        { separator: true },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !state.canEdit, run: actions.copy },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !state.canPaste, run: actions.paste },
        { label: 'Duplicate', disabled: !state.canEdit, run: actions.duplicate },
        { label: 'Delete', shortcut: 'Delete', disabled: !state.canEdit, run: actions.remove },
        { separator: true },
        { label: 'Copy and Print UUID', disabled: !state.hasNode, run: actions.copyUuid },
        { label: 'Copy and Print PATH', disabled: !state.hasNode, run: actions.copyPath },
    ];
}

/** The node's path from the scene, like `Canvas/UIScene/Label`. The scene itself is not part of it. */
export function pathOf (node: Node): string {
    const names: string[] = [];
    for (let n = node; n && n.parent; n = n.parent) names.unshift(n.name);
    return names.join('/');
}
