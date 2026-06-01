import { _decorator, Component } from 'cc';
import { GameTrackingService } from '../analytics/GameTrackingService.ts';
import superHtmlPlayable from './SuperHtmlPlayable.ts';

const { ccclass } = _decorator;

@ccclass('PlayableAdDownloadEvent')
export class PlayableAdDownloadEvent extends Component {
  onDownloadClick(eventOrUrl?: unknown, customUrl?: string): void {
    const url = customUrl
      || (typeof eventOrUrl === 'string' ? eventOrUrl : '')
      || superHtmlPlayable.get_download_url();

    GameTrackingService.logDownloadClick({ url });
    superHtmlPlayable.download();
  }
}
