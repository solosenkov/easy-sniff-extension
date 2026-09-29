import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Broadcast } from "@phosphor-icons/react";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
// Keep the toolbar mark identical to the app's Phosphor Broadcast brand symbol.
const mark = renderToStaticMarkup(
  React.createElement(Broadcast, {
    size: 82,
    weight: "bold",
    color: "#263321",
  }),
).replace("<svg ", '<svg x="23" y="23" ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="2" y="2" width="124" height="124" rx="31" fill="#b8ed96"/>${mark}</svg>`;
await mkdir("public/icons", { recursive: true });
await writeFile("public/icons/easy-sniff.svg", svg);
for (const size of [16, 32, 48, 128])
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon${size}.png`);
console.log("Generated 16, 32, 48 and 128 px icons.");
