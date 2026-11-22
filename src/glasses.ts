import {
  CreateStartUpPageContainer,
  type EvenAppBridge,
  type EvenHubEvent,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';

export const MENU_IDS = {
  LIKE: 1,
  REPOST: 2,
  SWITCH_FEED: 3,
  REFRESH: 4,
  NOTIFICATIONS: 5,
} as const;

const CONTAINER_HEADER = 1;
const CONTAINER_BODY = 2;
const CONTAINER_FOOTER = 3;

export interface GlassesScreen {
  header: string;
  body: string;
  footer: string;
}

export interface GlassesHandlers {
  onScrollUp: () => void;
  onScrollDown: () => void;
  onClick: () => void;
  onDoubleClick: () => void;
  onMenuItem: (itemId: number) => void;
  onLog: (msg: string) => void;
}

export class GlassesDisplay {
  private bridge: EvenAppBridge | null = null;
  private initialized = false;

  async connect(initialScreen: GlassesScreen, handlers: GlassesHandlers): Promise<boolean> {
    try {
      this.bridge = await waitForEvenAppBridge();
    } catch (err) {
      handlers.onLog(`Bridge unavailable (browser mode): ${(err as Error).message}`);
      return false;
    }

    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 3,
        textObject: [
          new TextContainerProperty({
            containerID: CONTAINER_HEADER,
            containerName: 'header',
            xPosition: 16,
            yPosition: 8,
            width: 544,
            height: 34,
            textColor: 3,
            isEventCapture: 0,
            content: initialScreen.header,
          }),
          new TextContainerProperty({
            containerID: CONTAINER_BODY,
            containerName: 'body',
            xPosition: 16,
            yPosition: 46,
            width: 544,
            height: 196,
            textColor: 4,
            isEventCapture: 1,
            content: initialScreen.body,
          }),
          new TextContainerProperty({
            containerID: CONTAINER_FOOTER,
            containerName: 'footer',
            xPosition: 16,
            yPosition: 248,
            width: 544,
            height: 32,
            textColor: 2,
            isEventCapture: 0,
            content: initialScreen.footer,
          }),
        ],
        menuObject: new MenuContainerProperty({
          menuItems: [
            new MenuItemProperty({ itemID: MENU_IDS.LIKE, itemName: 'Like / Unlike' }),
            new MenuItemProperty({ itemID: MENU_IDS.REPOST, itemName: 'Repost / Undo' }),
            new MenuItemProperty({ itemID: MENU_IDS.NOTIFICATIONS, itemName: 'Notifications' }),
            new MenuItemProperty({ itemID: MENU_IDS.SWITCH_FEED, itemName: 'Switch Feed' }),
            new MenuItemProperty({ itemID: MENU_IDS.REFRESH, itemName: 'Refresh Feed' }),
          ],
        }),
      }),
    );

    this.initialized = result === StartUpPageCreateResult.success;
    handlers.onLog(`createStartUpPageContainer -> ${result}`);

    this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
      handlers.onLog(`RAW: ${JSON.stringify(event)}`);

      if (event.menuItemClickEvent?.itemID !== undefined) {
        handlers.onMenuItem(event.menuItemClickEvent.itemID);
        return;
      }

      const hasInputEvent = Boolean(event.textEvent || event.sysEvent);
      if (!hasInputEvent) return;

      // Proto3 omits default enum 0 (CLICK_EVENT) in some host payloads.
      const eventType =
        event.textEvent?.eventType ??
        event.sysEvent?.eventType ??
        OsEventTypeList.CLICK_EVENT;

      switch (eventType) {
        case OsEventTypeList.SCROLL_BOTTOM_EVENT:
          handlers.onScrollDown();
          break;
        case OsEventTypeList.SCROLL_TOP_EVENT:
          handlers.onScrollUp();
          break;
        case OsEventTypeList.CLICK_EVENT:
          handlers.onClick();
          break;
        case OsEventTypeList.DOUBLE_CLICK_EVENT:
          handlers.onDoubleClick();
          break;
        case OsEventTypeList.LONG_PRESS_EVENT:
          handlers.onLog('Long press detected');
          break;
        default:
          handlers.onLog(`Unhandled eventType: ${eventType}`);
      }
    });

    return this.initialized;
  }

  async render(screen: GlassesScreen): Promise<void> {
    if (!this.bridge || !this.initialized) return;
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_HEADER,
        containerName: 'header',
        content: screen.header,
        textColor: 3,
      }),
    );
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_BODY,
        containerName: 'body',
        content: screen.body,
        textColor: 4,
      }),
    );
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_FOOTER,
        containerName: 'footer',
        content: screen.footer,
        textColor: 2,
      }),
    );
  }

  async getStorage(key: string): Promise<string | null> {
    if (this.bridge) {
      const val = await this.bridge.getLocalStorage(key);
      if (val) return val;
    }
    return window.localStorage.getItem(key);
  }

  async setStorage(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, value);
    if (this.bridge) {
      await this.bridge.setLocalStorage(key, value);
    }
  }

  async clearStorage(key: string): Promise<void> {
    window.localStorage.removeItem(key);
    if (this.bridge) {
      await this.bridge.setLocalStorage(key, '');
    }
  }
}
