export type DocumentPlayer = { page: number; pageCount: number; go(page: number): void };
export class DocumentControl {
  private binding?: { id: string; player: DocumentPlayer };
  bind(id: string, player: DocumentPlayer) {
    const lease = { id, player }; this.binding = lease;
    return () => { if (this.binding === lease) this.binding = undefined; };
  }
  status() { const value = this.binding; return value ? { id: value.id, page: value.player.page + 1, pageCount: value.player.pageCount } : null; }
  run(id: string, action: "next_page" | "previous_page" | "go_page", page?: number) {
    const value = this.binding;
    if (!value || value.id !== id || value.player.pageCount < 1) throw new Error("文档尚未准备好，请稍后再试");
    const target = action === "go_page" ? (page ?? NaN) - 1 : value.player.page + (action === "next_page" ? 1 : -1);
    if (!Number.isInteger(target) || target < 0 || target >= value.player.pageCount) throw new Error("已经到文档边界，或指定页码超出范围");
    if (target !== value.player.page) value.player.go(target);
    return { id, page: target + 1, pageCount: value.player.pageCount };
  }
}
export const documentControl = new DocumentControl();
