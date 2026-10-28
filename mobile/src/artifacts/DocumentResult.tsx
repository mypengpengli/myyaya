import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { documentNative, type DocumentInfo } from "../../modules/document-preview";
import { resultPresentation as presentation, type PresentationItem } from "./presentation";
import { exportOriginalArtifact, openOriginalArtifact } from "./artifact-export";
import { documentControl } from "./document-control";

export function DocumentResult({ item }: { item: PresentationItem }) {
  const [info, setInfo] = useState<DocumentInfo | null>(null), [page, setPage] = useState(0), [uri, setUri] = useState("");
  const [notice, setNotice] = useState("正在打开文件…");
  const [zoom, setZoom] = useState(1), [viewport, setViewport] = useState({ width: 400, height: 240 }), [ratio, setRatio] = useState(0.707);
  const [saving, setSaving] = useState(false);
  const pdfHeight = Math.min(viewport.height, viewport.width / ratio), pdfWidth = pdfHeight * ratio;
  useEffect(() => {
    if (!info) return;
    return documentControl.bind(item.id, { page, pageCount: info.pageCount, go: (target) => { presentation.loadingOrFailed(item.id); setPage(target); } });
  }, [item.id, info, page]);
  const saveOriginal = async () => {
    if (saving) return;
    setSaving(true); setNotice(""); presentation.pin(true);
    try { setNotice(await exportOriginalArtifact(item) ? "原文件已保存到所选位置，可用 WPS 等应用编辑。" : "已取消保存，原文件仍保留在作品中。"); }
    catch { setNotice("保存失败，请检查保存位置与剩余空间。原文件仍保留在作品中。"); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    let active = true;
    if (item.text !== undefined) { setInfo({ format: "text", simplified: false, pageCount: 1, pages: [{ title: item.title, text: item.text }] }); setNotice(""); return; }
    void documentNative().inspect(item.uri, item.mimeType ?? "application/octet-stream").then((value) => { if (active) { setInfo(value); setNotice(""); } })
      .catch(() => { if (active) { setNotice("此文件无法在这里预览，可用外部应用打开原文件。"); presentation.loadingOrFailed(item.id); } });
    return () => { active = false; };
  }, [item.id, item.uri, item.mimeType]);
  useEffect(() => {
    if (info?.format !== "pdf") return;
    let active = true; setUri(""); setNotice("正在加载页面…"); presentation.loadingOrFailed(item.id);
    void documentNative().renderPdf(item.uri, page).then((value) => { if (active) { setUri(value); setNotice(""); } })
      .catch(() => { if (active) setNotice("页面加载失败，可切换页面或打开原文件。"); });
    return () => { active = false; };
  }, [item.id, item.uri, info, page]);
  return <View style={styles.frame}>
    <View style={styles.toolbar}>
      <Text style={styles.hint}>{info?.simplified ? "内容预览 · 图片、动画及版式请打开原文件查看" : info ? `${page + 1} / ${info.pageCount}` : "文件预览"}</Text>
      {info?.format === "pdf" ? <View style={styles.zoom}>
        <Pressable accessibilityRole="button" accessibilityLabel="缩小 PDF" disabled={zoom <= 1} onPress={() => setZoom(Math.max(1, zoom - 1))}><Text style={styles.link}>缩小</Text></Pressable>
        <Text style={styles.hint}>{zoom}×</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="放大 PDF" disabled={zoom >= 4} onPress={() => setZoom(Math.min(4, zoom + 1))}><Text style={styles.link}>放大</Text></Pressable>
      </View> : null}
      {item.uri.startsWith("file:") ? <View style={styles.zoom}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => void saveOriginal()}><Text style={styles.link}>{saving ? "正在保存…" : "保存原文件"}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => { presentation.pin(true); void openOriginalArtifact(item).catch(() => setNotice("请先安装 WPS 或其他支持此格式的应用，再打开原文件。")); }}><Text style={styles.link}>打开原文件</Text></Pressable>
      </View> : null}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text> : null}
    {info?.format === "pdf" ? <View style={styles.page} onLayout={(event) => setViewport(event.nativeEvent.layout)}>{uri ?
      <ScrollView nestedScrollEnabled contentContainerStyle={{ minHeight: viewport.height, justifyContent: "center" }}>
        <ScrollView horizontal nestedScrollEnabled contentContainerStyle={{ minWidth: viewport.width, justifyContent: "center" }}>
          <Image source={{ uri }} resizeMode="contain" style={{ width: pdfWidth * zoom, height: pdfHeight * zoom }} onLoad={(event) => { const { width, height } = event.nativeEvent.source; if (width > 0 && height > 0) setRatio(width / height); presentation.loaded(item.id); }} onError={() => { presentation.loadingOrFailed(item.id); setNotice("页面显示失败"); }} />
        </ScrollView>
      </ScrollView> : null}</View> :
      info ? <ScrollView key={page} onLayout={() => presentation.loaded(item.id)} style={styles.page} contentContainerStyle={styles.content}><Text selectable style={styles.text}>{info.pages[page]?.text || "本页无可提取文字，请打开原文件查看图片或图表。"}</Text></ScrollView> : <View style={styles.page} />}
    {info && info.pageCount > 1 ? <View style={styles.pager}>
      <Pressable accessibilityRole="button" disabled={page === 0} onPress={() => setPage(page - 1)}><Text style={[styles.link, page === 0 && styles.disabled]}>上一页</Text></Pressable>
      <Text style={styles.hint}>{page + 1} / {info.pageCount}</Text>
      <Pressable accessibilityRole="button" disabled={page + 1 === info.pageCount} onPress={() => setPage(page + 1)}><Text style={[styles.link, page + 1 === info.pageCount && styles.disabled]}>下一页</Text></Pressable>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({ frame: { flex: 1, paddingTop: 58, paddingBottom: 30, paddingHorizontal: 14, gap: 6 }, toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, zoom: { flexDirection: "row", alignItems: "center", gap: 8 }, hint: { color: "#b1bdcf", fontSize: 11 }, link: { color: "#4bd8f5", fontSize: 13, padding: 8 }, page: { flex: 1, width: "100%" }, content: { padding: 15 }, text: { color: "#edf4ff", fontSize: 17, lineHeight: 27 }, pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 }, disabled: { opacity: 0.3 } });
