import { t } from "../lib/i18n";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "12px" },
  ".cm-scroller": {
    fontFamily: '"IBM Plex Mono", monospace',
    lineHeight: "1.85",
  },
  ".cm-gutters.cm-gutters-before": { backgroundColor: "transparent" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "#697375",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-activeLine": { backgroundColor: "#ffffff03" },
  ".cm-content": { padding: "18px 0" },
  ".cm-line": { padding: "0 16px" },
  ".cm-focused": { outline: "none" },
});
export function Editor({
  value,
  onChange,
  readOnly = false,
  label = t("Редактор"),
  language = "json",
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  label?: string;
  language?: string;
}) {
  const extensions = useMemo(
    () => [
      theme,
      EditorView.lineWrapping,
      ...(language === "json" ? [json()] : []),
    ],
    [language],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={oneDark}
      extensions={extensions}
      readOnly={readOnly}
      editable={!readOnly}
      aria-label={label}
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: !readOnly,
        autocompletion: !readOnly,
      }}
    />
  );
}
