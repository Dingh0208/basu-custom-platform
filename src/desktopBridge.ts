export function getDesktopBridge() {
  return window.clientAtlas ?? window.clientHub;
}
