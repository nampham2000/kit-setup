import { _decorator, Component, Node, UITransform } from 'cc';
const { ccclass, property, executeInEditMode } = _decorator;

/** UGUI Horizontal/VerticalLayoutGroup with child control/force expansion disabled.
 * Re-evaluate without allocation so resizing, active children and late prefab loads stay aligned.
 * Preferred/flexible sizing and fitters must be resolved by the porter before this adapter is used.
 */
@ccclass('UnityFixedLayoutGroup')
@executeInEditMode
export class UnityFixedLayoutGroup extends Component {
    @property vertical = false;
    @property alignment = 0;
    @property spacing = 0;
    @property paddingLeft = 0;
    @property paddingRight = 0;
    @property paddingTop = 0;
    @property paddingBottom = 0;
    @property useScaleWidth = false;
    @property useScaleHeight = false;
    @property reverse = false;
    @property([Node]) ignoredNodes: Node[] = [];

    protected onEnable(): void { this.layout(); }
    protected lateUpdate(): void { this.layout(); }

    public layout(): void {
        const parent = this.node.getComponent(UITransform);
        if (!parent) return;
        const children = this.node.children;
        const ax = (this.alignment % 3) * .5, ay = Math.floor(this.alignment / 3) * .5;
        let count = 0, total = 0;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child.active || this.ignoredNodes.indexOf(child) >= 0) continue;
            const rect = child.getComponent(UITransform); if (!rect) continue;
            total += this.vertical ? rect.height * (this.useScaleHeight ? child.scale.y : 1)
                : rect.width * (this.useScaleWidth ? child.scale.x : 1);
            count++;
        }
        if (!count) return;
        total += (count - 1) * this.spacing;
        const innerW = parent.width - this.paddingLeft - this.paddingRight;
        const innerH = parent.height - this.paddingTop - this.paddingBottom;
        // Unity does not center overflowing content along the main axis.
        let cursor = this.vertical ? this.paddingTop + Math.max(0, innerH - total) * ay
            : this.paddingLeft + Math.max(0, innerW - total) * ax;
        for (let k = 0; k < children.length; k++) {
            const child = children[this.reverse ? children.length - 1 - k : k];
            if (!child.active || this.ignoredNodes.indexOf(child) >= 0) continue;
            const rect = child.getComponent(UITransform); if (!rect) continue;
            const sx = this.useScaleWidth ? child.scale.x : 1, sy = this.useScaleHeight ? child.scale.y : 1;
            const w = rect.width * sx, h = rect.height * sy;
            const left = this.vertical ? this.paddingLeft + (innerW - w) * ax : cursor;
            const top = this.vertical ? cursor : this.paddingTop + (innerH - h) * ay;
            const x = -parent.width * parent.anchorX + left + w * rect.anchorX;
            const y = parent.height * (1 - parent.anchorY) - top - h * (1 - rect.anchorY);
            if (child.position.x !== x || child.position.y !== y) child.setPosition(x, y, child.position.z);
            cursor += (this.vertical ? h : w) + this.spacing;
        }
    }
}
