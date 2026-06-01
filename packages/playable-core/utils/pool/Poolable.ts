// Poolable.ts
import { _decorator, Component } from 'cc';
const { ccclass } = _decorator;

@ccclass('Poolable')
export class Poolable extends Component {
  onPoolGet(): void {}
  onPoolPut(): void {}
}
