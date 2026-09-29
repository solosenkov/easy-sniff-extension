import { t } from "../lib/i18n";
import { useState } from "react";
import {
  ArrowsLeftRight,
  BracketsCurly,
  Key,
  Lightning,
} from "@phosphor-icons/react";
import { Button, CopyButton, ErrorNote, Tabs } from "./Primitives";
import { Editor } from "./Editor";
import {
  decodeBase64,
  decodeJwt,
  decodeMessage,
  encodeBase64,
} from "../lib/decoders";
export function Tools({ initialInput = "" }: { initialInput?: string }) {
  const [tool, setTool] = useState("ws");
  const [input, setInput] = useState(initialInput);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(encode = false) {
    setError("");
    setNote("");
    setOutput("");
    setBusy(true);
    try {
      if (!input.trim()) throw new Error(t("Введите данные для обработки"));
      if (tool === "jwt") {
        const jwt = decodeJwt(input);
        setOutput(
          JSON.stringify(
            {
              header: jwt.header,
              payload: jwt.payload,
              signature: jwt.signature,
            },
            null,
            2,
          ),
        );
        setNote(
          t("Подпись не проверена.{0}", [
            jwt.expired === true
              ? t(" Срок истёк.")
              : jwt.expired === false
                ? t(" Срок действия ещё не истёк.")
                : "",
          ]),
        );
      } else if (tool === "ws") {
        const result = await decodeMessage(input);
        setOutput(result.text);
        setNote(result.method);
      } else if (tool === "json")
        setOutput(JSON.stringify(JSON.parse(input), null, 2));
      else if (tool === "base64")
        setOutput(encode ? encodeBase64(input) : decodeBase64(input));
      else
        setOutput(
          encode ? encodeURIComponent(input) : decodeURIComponent(input),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page tools-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("ПОД РУКОЙ")}</span>
          <h1>{t("Декодеры")}</h1>
          <p>{t("Превратить нечитаемое в понятное.")}</p>
        </div>
        <span className="local-tag">{t("Обработка на устройстве")}</span>
      </div>
      <Tabs
        value={tool}
        onChange={(v) => {
          setTool(v);
          setOutput("");
          setError("");
          setNote("");
        }}
        items={[
          { id: "ws", label: "WebSocket" },
          { id: "jwt", label: "JWT" },
          { id: "json", label: "JSON" },
          { id: "base64", label: "Base64" },
          { id: "url", label: "URL" },
        ]}
      />
      <div className="tools-split">
        <section>
          <div className="section-toolbar">
            <span>{t("Исходные данные")}</span>
            <Button
              className="quiet"
              onClick={() => {
                setInput("");
                setOutput("");
                setNote("");
                setError("");
              }}
            >
              {t("Очистить")}
            </Button>
          </div>
          <textarea
            className="tool-input"
            aria-label={t("Исходные данные декодера")}
            placeholder={
              tool === "jwt"
                ? "eyJhbGciOiJIUzI1NiIs…"
                : tool === "ws"
                  ? t("Вставьте сообщение: JSON, Base64, zlib или gzip")
                  : t("Вставьте данные для обработки")
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
          <div className="tool-actions">
            <Button
              className="primary"
              icon={
                tool === "jwt"
                  ? Key
                  : tool === "json"
                    ? BracketsCurly
                    : Lightning
              }
              disabled={busy}
              onClick={() => void run()}
            >
              {busy
                ? t("Обработка…")
                : tool === "json"
                  ? t("Форматировать")
                  : t("Декодировать")}
            </Button>
            {["base64", "url"].includes(tool) && (
              <Button icon={ArrowsLeftRight} onClick={() => void run(true)}>
                {t("Кодировать")}
              </Button>
            )}
          </div>
          <p className="muted tool-description">
            {tool === "ws"
              ? t(
                  "Автоопределение цепочек Base64, двойного Base64, zlib и gzip.",
                )
              : tool === "jwt"
                ? t(
                    "Чтение header и payload, включая Base64URL и Unicode. Декодирование не подтверждает подлинность токена.",
                  )
                : t("Результат можно скопировать и использовать в запросе.")}
          </p>
        </section>
        <section>
          <div className="section-toolbar">
            <span>{t("Результат")}</span>
            <CopyButton value={output} />
          </div>
          <ErrorNote error={error} />
          {note && <div className="inline-hint">{note}</div>}
          {output ? (
            <Editor
              value={output}
              readOnly
              label={t("Результат декодирования")}
            />
          ) : (
            <div className="tool-placeholder">
              <BracketsCurly size={32} weight="light" />
              <p>{t("Готово к расшифровке")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
