import { Node } from 'cc';
import { Command } from './History';

/**
 * A node was added to the scene. Undo takes it out again without destroying it, so a
 * redo can put the very same node back, components and all, rather than a copy.
 */
export class AddNodeCommand implements Command {
    constructor (
        public label: string,
        private _node: Node,
        private _parent: Node,
        private _index: number,
    ) {}

    public undo () {
        if (this._node.isValid) this._node.removeFromParent();
    }

    public redo () {
        if (this._node.isValid && this._parent.isValid && !this._node.parent) {
            this._parent.insertChild(this._node, this._index);
        }
    }
}

/** A node was taken out of the scene. The mirror image of AddNodeCommand. */
export class RemoveNodeCommand implements Command {
    constructor (
        public label: string,
        private _node: Node,
        private _parent: Node,
        private _index: number,
    ) {}

    public undo () {
        if (this._node.isValid && this._parent.isValid && !this._node.parent) {
            this._parent.insertChild(this._node, this._index);
        }
    }

    public redo () {
        if (this._node.isValid) this._node.removeFromParent();
    }
}
