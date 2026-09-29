import { t } from "../lib/i18n";
import { lazy, Suspense } from "react";
const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({ default: module.Editor })),
);
export function Editor(props: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  label?: string;
  language?: string;
}) {
  return (
    <Suspense
      fallback={<div className="inline-hint">{t("Открываем редактор…")}</div>}
    >
      <CodeEditor {...props} />
    </Suspense>
  );
}
