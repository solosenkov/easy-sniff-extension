import {
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);
const notices = [
  "Third-party notices for Easy Sniff",
  "These dependencies retain their original licenses.\n",
];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || pkg.dev) continue;
  const dir = resolve(root, path);
  const names = readdirSync(dir).filter((name) =>
    /^(licen[cs]e|copying|ofl)(?:[._-].*)?$/i.test(name),
  );
  const name = path.replace(/^node_modules\//, "");
  let text = names
    .map((file) => readFileSync(resolve(dir, file), "utf8"))
    .join("\n\n");
  if (!text && name.startsWith("@uiw/")) {
    text = readFileSync(
      resolve(root, "scripts/licenses/uiw-react-codemirror.txt"),
      "utf8",
    );
  }
  if (!text) throw new Error(`Missing third-party license: ${name}`);
  notices.push(
    `${name} ${pkg.version} (${pkg.license || "see license"})\n${text}`,
  );
}
copyFileSync(resolve(root, "LICENSE"), resolve(root, "dist/LICENSE"));
writeFileSync(
  resolve(root, "dist/THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n--------------------\n\n"),
);
