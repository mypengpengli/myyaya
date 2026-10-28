import { requireNativeModule } from "expo";
export type DocumentPage = { title: string; text: string };
export type DocumentInfo = { format: string; pages: DocumentPage[]; pageCount: number; simplified: boolean };
type Native = {
  pickFile(): Promise<{ id: string; uri: string; mimeType: string; title: string } | null>;
  inspect(uri: string, mime: string): Promise<DocumentInfo>;
  renderPdf(uri: string, page: number): Promise<string>;
  openOriginal(uri: string, mime: string, title: string): Promise<void>;
  saveOriginal(uri: string, mime: string, title: string): Promise<boolean>;
  download(url: string, token: string, sha256: string, bytes: number, id: string, extension: string): Promise<string>;
};
let native: Native | undefined;
export const documentNative = () => native ??= requireNativeModule<Native>("DocumentPreview");
