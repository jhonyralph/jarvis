import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_MOBILE_DIR = dirname(SCRIPT_FILE);
const ANDROID_PLUGIN_CLASS = "chat.jarvis.context.JarvisContextPlugin";
const ANDROID_BOOT_RECEIVER = "chat.jarvis.context.JarvisContextBootReceiver";
const TOOLS_NAMESPACE = "http://schemas.android.com/tools";

export class ContextNativeTransformError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContextNativeTransformError";
  }
}

function diagnostic(message) {
  throw new ContextNativeTransformError(`[context-native] ${message}`);
}

function requiredFile(path, purpose) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    diagnostic(`missing ${purpose}: ${path}`);
  }
  return path;
}

function requiredDirectory(path, purpose) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    diagnostic(`missing ${purpose}: ${path}`);
  }
  return path;
}

function eolOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function lineIndentAt(text, index) {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return /^[\t ]*/.exec(text.slice(start, index))?.[0] ?? "";
}

function xmlTagEnd(text, start, path) {
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  diagnostic(`unterminated XML tag in ${path}`);
}

function xmlAttributes(openTag) {
  const attributes = new Map();
  const pattern = /([^\s=<>/]+)\s*=\s*(['"])([\s\S]*?)\2/g;
  for (const match of openTag.matchAll(pattern)) attributes.set(match[1], match[3]);
  return attributes;
}

function xmlDeclarationEnd(text, start, path) {
  let quote = "";
  let subsetDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "[") {
      subsetDepth += 1;
    } else if (character === "]") {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === ">" && subsetDepth === 0) {
      return index + 1;
    }
  }
  diagnostic(`unterminated XML declaration in ${path}`);
}

function xmlTokens(text, path) {
  const tokens = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) break;
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end < 0) diagnostic(`unterminated XML comment in ${path}`);
      cursor = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", start)) {
      const end = text.indexOf("]]>", start + 9);
      if (end < 0) diagnostic(`unterminated XML CDATA section in ${path}`);
      cursor = end + 3;
      continue;
    }
    if (text.startsWith("<?", start)) {
      const end = text.indexOf("?>", start + 2);
      if (end < 0) diagnostic(`unterminated XML processing instruction in ${path}`);
      cursor = end + 2;
      continue;
    }
    if (text.startsWith("<!", start)) {
      cursor = xmlDeclarationEnd(text, start, path);
      continue;
    }
    const openEnd = xmlTagEnd(text, start, path);
    const openTag = text.slice(start, openEnd);
    const match = /^<\s*(\/?)\s*([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s/>])/.exec(openTag);
    if (match) {
      tokens.push({
        start,
        openEnd,
        openTag,
        name: match[2],
        closing: match[1] === "/",
        selfClosing: match[1] !== "/" && /\/\s*>$/.test(openTag),
      });
    }
    cursor = openEnd;
  }
  return tokens;
}

function xmlElements(text, name, path) {
  const matches = [];
  const tokens = xmlTokens(text, path);
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token.name !== name || token.closing) continue;
    let end = token.openEnd;
    if (!token.selfClosing) {
      let depth = 1;
      for (let candidateIndex = tokenIndex + 1; candidateIndex < tokens.length; candidateIndex += 1) {
        const candidate = tokens[candidateIndex];
        if (candidate.name !== name) continue;
        if (candidate.closing) depth -= 1;
        else if (!candidate.selfClosing) depth += 1;
        if (depth === 0) {
          end = candidate.openEnd;
          break;
        }
      }
      if (depth !== 0) diagnostic(`missing </${name}> in ${path}`);
    }
    matches.push({
      start: token.start,
      openEnd: token.openEnd,
      end,
      openTag: token.openTag,
      selfClosing: token.selfClosing,
      attributes: xmlAttributes(token.openTag),
      indent: lineIndentAt(text, token.start),
    });
  }
  return matches;
}

function replaceXmlElement(text, element, replacement) {
  return `${text.slice(0, element.start)}${replacement}${text.slice(element.end)}`;
}

function removeXmlElements(text, name, path, predicate) {
  let output = text;
  for (;;) {
    const element = xmlElements(output, name, path).find(predicate);
    if (!element) return output;
    let start = element.start;
    let end = element.end;
    if (/^[\t ]*$/.test(output.slice(output.lastIndexOf("\n", start - 1) + 1, start))) {
      start = output.lastIndexOf("\n", start - 1) + 1;
      if (output[end] === "\r" && output[end + 1] === "\n") end += 2;
      else if (output[end] === "\n") end += 1;
    }
    output = `${output.slice(0, start)}${output.slice(end)}`;
  }
}

function setXmlAttributeOnTag(openTag, name, value) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\s${escaped}\\s*=\\s*)(['"])[\\s\\S]*?\\2`);
  if (pattern.test(openTag)) return openTag.replace(pattern, `$1"${value}"`);
  const close = /\/\s*>$/.test(openTag) ? openTag.lastIndexOf("/") : openTag.lastIndexOf(">");
  const prefix = openTag.slice(0, close);
  if (prefix.includes("\n")) {
    const indent = /(?:^|\n)([\t ]*)[^\n]*$/.exec(prefix)?.[1] ?? "    ";
    return `${prefix}${eolOf(openTag)}${indent}${name}="${value}"${openTag.slice(close)}`;
  }
  return `${prefix} ${name}="${value}"${openTag.slice(close)}`;
}

function setElementAttribute(text, element, name, value) {
  const openTag = setXmlAttributeOnTag(element.openTag, name, value);
  return `${text.slice(0, element.start)}${openTag}${text.slice(element.openEnd)}`;
}

function normalizeRelative(from, to) {
  const value = relative(from, to).split(sep).join("/");
  if (!value || /^[A-Za-z]:/.test(value)) {
    diagnostic(`plugin path must be relative to the generated project (${from} -> ${to})`);
  }
  return value;
}

function stageChanged(path, before, after, stagedFiles) {
  if (typeof after !== "string") diagnostic(`transform returned invalid content for ${path}`);
  if (before !== null && before === after) return;
  stagedFiles.set(path, after);
}

function patchFile(path, transform, stagedFiles) {
  const before = readFileSync(path, "utf8");
  stageChanged(path, before, transform(before, path), stagedFiles);
}

function createOrPatch(path, initial, transform, stagedFiles) {
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  const input = before ?? initial;
  stageChanged(path, before, transform(input, path), stagedFiles);
}

function matchingDelimiter(text, openIndex, openCharacter, closeCharacter, path) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  diagnostic(`could not find closing ${closeCharacter} in ${path}`);
}

function namedBraceBlock(text, name, path, fromIndex = 0) {
  const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{`, "g");
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(text);
  if (!match) diagnostic(`missing ${name} { ... } anchor in ${path}`);
  const open = text.indexOf("{", match.index);
  return { open, close: matchingDelimiter(text, open, "{", "}", path) };
}

function removeLegacyAndroidSettingsLink(text) {
  return text
    .replace(/\r?\n?\/\/ jarvis-context:start[\s\S]*?\/\/ jarvis-context:end\r?\n?/g, "\n")
    .replace(/^[\t ]*include\s+['"]:jarvis-context['"][\t ]*\r?\n/gm, "")
    .replace(/^[\t ]*project\s*\(\s*['"]:jarvis-context['"]\s*\)\.projectDir[^\r\n]*\r?\n/gm, "");
}

function ensureAndroidFlavors(text, path) {
  if (text.includes("jarvis-context:flavors:start")) {
    for (const expected of ["jarvisDistribution", "store", "sideload"]) {
      if (!text.includes(expected)) diagnostic(`incomplete jarvis-context flavor block in ${path}`);
    }
    return text;
  }
  if (/\bproductFlavors\s*\{[\s\S]*?\b(?:store|sideload)\b/.test(text)) {
    diagnostic(`existing store/sideload product flavor conflicts with jarvis-context in ${path}`);
  }
  const android = namedBraceBlock(text, "android", path);
  const eol = eolOf(text);
  const indent = `${lineIndentAt(text, android.open)}    `;
  const block = [
    "// jarvis-context:flavors:start",
    'flavorDimensions += "jarvisDistribution"',
    "productFlavors {",
    "    store {",
    '        dimension "jarvisDistribution"',
    "    }",
    "    sideload {",
    '        dimension "jarvisDistribution"',
    "    }",
    "}",
    "// jarvis-context:flavors:end",
  ].map((line) => `${indent}${line}`).join(eol);
  return `${text.slice(0, android.open + 1)}${eol}${block}${text.slice(android.open + 1)}`;
}

function removeLegacyAndroidDependency(text) {
  return text
    .replace(/^[\t ]*\/\/ jarvis-context[\t ]*\r?\n(?=[\t ]*implementation\s+project)/gm, "")
    .replace(/^[\t ]*implementation\s+project\s*\(\s*['"]:jarvis-context['"]\s*\)[\t ]*\r?\n/gm, "");
}

function ensureManifestPermission(text, permission, path, attributes = {}) {
  let output = text;
  if (!("tools:node" in attributes)) {
    output = removeXmlElements(
      output,
      "uses-permission",
      path,
      (element) => element.attributes.get("android:name") === permission &&
        new Set(["remove", "removeAll"]).has(element.attributes.get("tools:node")),
    );
  }
  if (xmlElements(output, "uses-permission", path)
    .some((element) => element.attributes.get("android:name") === permission &&
      Object.entries(attributes).every(([name, value]) => element.attributes.get(name) === value))) return output;
  const application = xmlElements(output, "application", path)[0];
  const marker = "</manifest>";
  const index = application
    ? application.start - application.indent.length
    : output.lastIndexOf(marker);
  if (index < 0) diagnostic(`missing </manifest> in ${path}`);
  const eol = eolOf(output);
  const extra = Object.entries(attributes).map(([name, value]) => ` ${name}="${value}"`).join("");
  const chunk = `    <uses-permission android:name="${permission}"${extra} />${eol}`;
  return `${output.slice(0, index)}${chunk}${output.slice(index)}`;
}

function normalizeManifestPermissionOrder(text, path) {
  const application = xmlElements(text, "application", path)[0];
  if (!application) return text;
  const latePermissions = xmlElements(text, "uses-permission", path)
    .filter((element) => element.start > application.start);
  if (!latePermissions.length) return text;

  const eol = eolOf(text);
  const snippets = latePermissions.map((element) =>
    text.slice(element.start, element.end).trim()
      .split(/\r?\n/)
      .map((line, index) => `${index === 0 ? "    " : "        "}${line.trim()}`)
      .join(eol));
  let output = text;
  for (const element of latePermissions.toReversed()) {
    let start = element.start;
    let end = element.end;
    if (/^[\t ]*$/.test(output.slice(output.lastIndexOf("\n", start - 1) + 1, start))) {
      start = output.lastIndexOf("\n", start - 1) + 1;
      if (output[end] === "\r" && output[end + 1] === "\n") end += 2;
      else if (output[end] === "\n") end += 1;
    }
    output = `${output.slice(0, start)}${output.slice(end)}`;
  }
  const currentApplication = xmlElements(output, "application", path)[0];
  const index = currentApplication.start - currentApplication.indent.length;
  return `${output.slice(0, index)}${snippets.join(eol)}${eol}${output.slice(index)}`;
}

function ensureToolsNamespace(text, path) {
  const manifest = xmlElements(text, "manifest", path)[0];
  if (!manifest) diagnostic(`missing <manifest> in ${path}`);
  if (manifest.attributes.get("xmlns:tools") === TOOLS_NAMESPACE) return text;
  return setElementAttribute(text, manifest, "xmlns:tools", TOOLS_NAMESPACE);
}

function ensureApplicationChild(text, child, identity, path) {
  if (xmlElements(text, "receiver", path).some((element) =>
    element.attributes.get("android:name") === identity)) return text;
  const eol = eolOf(text);
  const application = xmlElements(text, "application", path)[0];
  if (application) {
    if (application.selfClosing) {
      const open = application.openTag.replace(/\/\s*>$/, ">");
      const replacement = `${open}${eol}${child}${eol}${application.indent}</application>`;
      return replaceXmlElement(text, application, replacement);
    }
    const close = text.lastIndexOf("</application>", application.end);
    const inner = text.slice(application.openEnd, close);
    const trailingWhitespace = /\s*$/.exec(inner)?.[0].length ?? 0;
    const existingEnd = close - trailingWhitespace;
    const prefix = existingEnd === application.openEnd
      ? text.slice(0, application.openEnd)
      : text.slice(0, existingEnd);
    return `${prefix}${eol}${child}${eol}${application.indent}${text.slice(close)}`;
  }
  const manifestClose = text.lastIndexOf("</manifest>");
  if (manifestClose < 0) diagnostic(`missing </manifest> in ${path}`);
  return `${text.slice(0, manifestClose)}    <application>${eol}${child}${eol}    </application>${eol}${text.slice(manifestClose)}`;
}

function removeManifestPermission(text, permission, path) {
  return removeXmlElements(
    text,
    "uses-permission",
    path,
    (element) => element.attributes.get("android:name") === permission,
  );
}

function removeBootReceiver(text, path) {
  return removeXmlElements(
    text,
    "receiver",
    path,
    (element) => element.attributes.get("android:name") === ANDROID_BOOT_RECEIVER,
  );
}

function patchMainManifest(text, path) {
  let output = text;
  for (const permission of [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.READ_CALENDAR",
  ]) {
    output = ensureManifestPermission(output, permission, path);
  }
  if (output.includes("android.permission.WRITE_CALENDAR")) {
    diagnostic(`WRITE_CALENDAR is not allowed in ${path}`);
  }
  output = removeManifestPermission(output, "android.permission.ACCESS_BACKGROUND_LOCATION", path);
  return normalizeManifestPermissionOrder(output, path);
}

function insertXmlChild(text, parentName, child, path) {
  const parent = xmlElements(text, parentName, path)[0];
  if (!parent) diagnostic(`missing <${parentName}> in ${path}`);
  const eol = eolOf(text);
  const indent = `${parent.indent}    `;
  const indentedChild = child.split(/\r?\n/).map((line) => `${indent}${line}`).join(eol);
  if (parent.selfClosing) {
    const open = parent.openTag.replace(/\/\s*>$/, ">");
    return replaceXmlElement(
      text,
      parent,
      `${open}${eol}${indentedChild}${eol}${parent.indent}</${parentName}>`,
    );
  }
  const closeStart = parent.end - new RegExp(`</${parentName}\\s*>$`).exec(text.slice(parent.start, parent.end))[0].length;
  const inner = text.slice(parent.openEnd, closeStart);
  const trailingWhitespace = /\s*$/.exec(inner)?.[0].length ?? 0;
  const existingEnd = closeStart - trailingWhitespace;
  const prefix = existingEnd === parent.openEnd
    ? text.slice(0, parent.openEnd)
    : text.slice(0, existingEnd);
  return `${prefix}${eol}${indentedChild}${eol}${parent.indent}${text.slice(closeStart)}`;
}

function ensureBackupExclude(text, containerName, path) {
  const container = xmlElements(text, containerName, path)[0];
  if (!container) diagnostic(`missing <${containerName}> in ${path}`);
  const containerText = text.slice(container.start, container.end);
  const cleanedContainer = removeXmlElements(
    containerText,
    "exclude",
    path,
    (element) => element.attributes.get("domain") === "sharedpref" &&
      element.attributes.get("path") === "jarvis_context.xml",
  );
  const withoutManagedRule = replaceXmlElement(text, container, cleanedContainer);
  return insertXmlChild(
    withoutManagedRule,
    containerName,
    '<exclude domain="sharedpref" path="jarvis_context.xml" />',
    path,
  );
}

function patchFullBackupRules(text, path) {
  if (!xmlElements(text, "full-backup-content", path).length) {
    diagnostic(`missing <full-backup-content> in ${path}`);
  }
  return ensureBackupExclude(text, "full-backup-content", path);
}

function patchDataExtractionRules(text, path) {
  if (!xmlElements(text, "data-extraction-rules", path).length) {
    diagnostic(`missing <data-extraction-rules> in ${path}`);
  }
  let output = text;
  for (const container of ["cloud-backup", "device-transfer"]) {
    if (!xmlElements(output, container, path).length) {
      output = insertXmlChild(output, "data-extraction-rules", `<${container}></${container}>`, path);
    }
    output = ensureBackupExclude(output, container, path);
  }
  return output;
}

function fullBackupTemplate() {
  return `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
</full-backup-content>
`;
}

function dataExtractionTemplate() {
  return `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
</data-extraction-rules>
`;
}

function configureBackupRule({
  manifest,
  manifestPath,
  attribute,
  fallbackName,
  resourceDirectory,
  initial,
  transform,
  stagedFiles,
}) {
  let output = manifest;
  let application = xmlElements(output, "application", manifestPath)[0];
  if (!application) {
    output = ensureApplicationChild(output, "", "__never__", manifestPath);
    application = xmlElements(output, "application", manifestPath)[0];
  }
  let reference = application.attributes.get(attribute);
  if (reference === "false") return output;
  if (!reference || reference === "true") {
    reference = `@xml/${fallbackName}`;
    output = setElementAttribute(output, application, attribute, reference);
  }
  const match = /^@xml\/([A-Za-z0-9_.]+)$/.exec(reference);
  if (!match) diagnostic(`${attribute} must be false or an @xml resource in ${manifestPath}`);
  const resource = join(resourceDirectory, `${match[1]}.xml`);
  if (match[1] !== fallbackName && !existsSync(resource)) {
    diagnostic(`cannot safely extend missing ${reference} referenced by ${manifestPath}`);
  }
  createOrPatch(resource, initial, transform, stagedFiles);
  return output;
}

function patchAndroidBackupConfiguration(text, path, resourceDirectory, stagedFiles) {
  let output = configureBackupRule({
    manifest: text,
    manifestPath: path,
    attribute: "android:fullBackupContent",
    fallbackName: "jarvis_context_backup_rules",
    resourceDirectory,
    initial: fullBackupTemplate(),
    transform: patchFullBackupRules,
    stagedFiles,
  });
  output = configureBackupRule({
    manifest: output,
    manifestPath: path,
    attribute: "android:dataExtractionRules",
    fallbackName: "jarvis_context_data_extraction_rules",
    resourceDirectory,
    initial: dataExtractionTemplate(),
    transform: patchDataExtractionRules,
    stagedFiles,
  });
  return output;
}

function storeManifestTemplate() {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <uses-permission
        android:name="android.permission.ACCESS_BACKGROUND_LOCATION"
        tools:node="remove" />
    <application>
        <receiver
            android:name="chat.jarvis.context.JarvisContextBootReceiver"
            tools:node="remove" />
    </application>
</manifest>
`;
}

function sideloadManifestTemplate() {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <application>
        <receiver
            android:name="chat.jarvis.context.JarvisContextBootReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
`;
}

function storeBootReceiver(indent, eol) {
  return [
    `${indent}<receiver`,
    `${indent}    android:name="${ANDROID_BOOT_RECEIVER}"`,
    `${indent}    tools:node="remove" />`,
  ].join(eol);
}

function sideloadBootReceiver(indent, eol) {
  return [
    `${indent}<receiver`,
    `${indent}    android:name="${ANDROID_BOOT_RECEIVER}"`,
    `${indent}    android:enabled="true"`,
    `${indent}    android:exported="true">`,
    `${indent}    <intent-filter>`,
    `${indent}        <action android:name="android.intent.action.BOOT_COMPLETED" />`,
    `${indent}        <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />`,
    `${indent}    </intent-filter>`,
    `${indent}</receiver>`,
  ].join(eol);
}

function patchStoreManifest(text, path) {
  let output = ensureToolsNamespace(text, path);
  for (const permission of [
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.RECEIVE_BOOT_COMPLETED",
  ]) {
    output = removeManifestPermission(output, permission, path);
    output = ensureManifestPermission(output, permission, path, { "tools:node": "remove" });
  }
  output = removeBootReceiver(output, path);
  output = ensureApplicationChild(
    output,
    storeBootReceiver("        ", eolOf(output)),
    ANDROID_BOOT_RECEIVER,
    path,
  );
  return output;
}

function patchSideloadManifest(text, path) {
  let output = text;
  for (const permission of [
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.RECEIVE_BOOT_COMPLETED",
  ]) {
    output = removeManifestPermission(output, permission, path);
    output = ensureManifestPermission(output, permission, path);
  }
  output = removeBootReceiver(output, path);
  output = ensureApplicationChild(
    output,
    sideloadBootReceiver("        ", eolOf(output)),
    ANDROID_BOOT_RECEIVER,
    path,
  );
  for (const action of ["android.intent.action.BOOT_COMPLETED", "android.intent.action.MY_PACKAGE_REPLACED"]) {
    if (!output.includes(action)) diagnostic(`boot receiver in ${path} is missing ${action}`);
  }
  return output;
}

function manifestHasPermission(text, permission, path, toolsNode = undefined) {
  return xmlElements(text, "uses-permission", path).some((element) =>
    element.attributes.get("android:name") === permission &&
    (toolsNode === undefined || element.attributes.get("tools:node") === toolsNode));
}

function manifestHasReceiver(text, receiver, path, toolsNode = undefined) {
  return xmlElements(text, "receiver", path).some((element) =>
    element.attributes.get("android:name") === receiver &&
    (toolsNode === undefined || element.attributes.get("tools:node") === toolsNode));
}

function activeManifestElement(element) {
  return !new Set(["remove", "removeAll"]).has(element.attributes.get("tools:node"));
}

function activeManifestPermission(text, permission, path) {
  return xmlElements(text, "uses-permission", path).some((element) =>
    element.attributes.get("android:name") === permission && activeManifestElement(element));
}

function bootReceiverPolicy(text, path) {
  const receiver = xmlElements(text, "receiver", path).find((element) =>
    element.attributes.get("android:name") === ANDROID_BOOT_RECEIVER && activeManifestElement(element));
  if (!receiver) return null;
  const receiverText = text.slice(receiver.start, receiver.end);
  const actions = new Set(
    xmlElements(receiverText, "action", path).map((element) => element.attributes.get("android:name")),
  );
  return {
    enabled: receiver.attributes.get("android:enabled") !== "false",
    exported: receiver.attributes.get("android:exported") === "true",
    actions,
  };
}

function manifestHasDefensiveBackupPolicy(text, path) {
  const application = xmlElements(text, "application", path)[0];
  if (!application) return false;
  if (application.attributes.get("android:allowBackup") === "false") return true;
  const fullBackup = application.attributes.get("android:fullBackupContent") ?? "";
  const extraction = application.attributes.get("android:dataExtractionRules") ?? "";
  return (fullBackup === "false" || /^@xml\/[A-Za-z0-9_.]+$/.test(fullBackup)) &&
    /^@xml\/[A-Za-z0-9_.]+$/.test(extraction);
}

export function verifyMergedAndroidManifest(text, variant, path = `${variant} merged manifest`) {
  if (!new Set(["store", "sideload"]).has(variant)) diagnostic(`unknown Android variant: ${variant}`);
  if (!manifestHasDefensiveBackupPolicy(text, path)) {
    diagnostic(`manifest does not enforce defensive backup configuration: ${path}`);
  }
  const background = activeManifestPermission(text, "android.permission.ACCESS_BACKGROUND_LOCATION", path);
  const bootPermission = activeManifestPermission(text, "android.permission.RECEIVE_BOOT_COMPLETED", path);
  const bootReceiver = bootReceiverPolicy(text, path);
  if (variant === "store" && (background || bootPermission || bootReceiver !== null)) {
    diagnostic(`store manifest contains background location or context boot rearm: ${path}`);
  }
  if (variant === "sideload" && (!background || !bootPermission || !bootReceiver)) {
    diagnostic(`sideload manifest is missing background location or context boot rearm: ${path}`);
  }
  if (variant === "sideload" && (!bootReceiver.enabled || !bootReceiver.exported ||
      !bootReceiver.actions.has("android.intent.action.BOOT_COMPLETED") ||
      !bootReceiver.actions.has("android.intent.action.MY_PACKAGE_REPLACED"))) {
    diagnostic(`sideload context boot receiver is not operational: ${path}`);
  }
  return true;
}

function verifyAndroidTransformOutput(paths, stagedFiles) {
  const content = (path) => stagedFiles.get(path) ?? readFileSync(path, "utf8");
  const main = content(paths.mainManifest);
  const store = content(paths.storeManifest);
  const sideload = content(paths.sideloadManifest);
  const activity = content(paths.mainActivity);
  const settings = content(paths.settings);
  const capacitorSettings = content(paths.capacitorSettings);
  const appGradle = content(paths.appGradle);
  const capacitorGradle = content(paths.capacitorGradle);
  const mainApplication = xmlElements(main, "application", paths.mainManifest)[0];
  if (!mainApplication) diagnostic(`missing application in ${paths.mainManifest}`);
  if (manifestHasPermission(main, "android.permission.ACCESS_BACKGROUND_LOCATION", paths.mainManifest)) {
    diagnostic(`main manifest still declares background location: ${paths.mainManifest}`);
  }
  for (const attribute of ["android:fullBackupContent", "android:dataExtractionRules"]) {
    if (!mainApplication.attributes.has(attribute)) {
      diagnostic(`main manifest is missing ${attribute}: ${paths.mainManifest}`);
    }
  }
  if (!manifestHasPermission(store, "android.permission.ACCESS_BACKGROUND_LOCATION", paths.storeManifest, "remove") ||
      !manifestHasPermission(store, "android.permission.RECEIVE_BOOT_COMPLETED", paths.storeManifest, "remove") ||
      !manifestHasReceiver(store, ANDROID_BOOT_RECEIVER, paths.storeManifest, "remove")) {
    diagnostic(`store source manifest does not remove all context background components: ${paths.storeManifest}`);
  }
  if (!manifestHasPermission(sideload, "android.permission.ACCESS_BACKGROUND_LOCATION", paths.sideloadManifest) ||
      !manifestHasPermission(sideload, "android.permission.RECEIVE_BOOT_COMPLETED", paths.sideloadManifest) ||
      !manifestHasReceiver(sideload, ANDROID_BOOT_RECEIVER, paths.sideloadManifest)) {
    diagnostic(`sideload source manifest is incomplete: ${paths.sideloadManifest}`);
  }
  if (/registerPlugin\s*\(\s*JarvisContextPlugin|import\s+chat\.jarvis\.context\.JarvisContextPlugin/.test(activity)) {
    diagnostic(`legacy manual Android plugin registration remains in ${paths.mainActivity}`);
  }
  if (/:jarvis-context/.test(settings) || /implementation\s+project\s*\(\s*['"]:jarvis-context/.test(appGradle)) {
    diagnostic("legacy JarvisContext Gradle linking remains outside Capacitor-generated files");
  }
  if ((capacitorSettings.match(/include\s+['"]:jarvis-context['"]/g) ?? []).length !== 1 ||
      (capacitorGradle.match(/implementation\s+project\s*\(\s*['"]:jarvis-context['"]\s*\)/g) ?? []).length !== 1) {
    diagnostic("Capacitor 8 did not generate exactly one JarvisContext project/dependency link; run cap sync android");
  }
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function findMainActivity(androidDir) {
  const javaRoot = requiredDirectory(join(androidDir, "app", "src", "main", "java"), "Android Java source root");
  const matches = walkFiles(javaRoot).filter((path) => /MainActivity\.(?:java|kt)$/.test(path));
  if (matches.length !== 1) {
    diagnostic(`expected exactly one MainActivity.java or MainActivity.kt under ${javaRoot}; found ${matches.length}`);
  }
  return matches[0];
}

function patchMainActivity(text, path) {
  let output = text
    .replace(new RegExp(`^[\\t ]*import[\\t ]+${ANDROID_PLUGIN_CLASS.replaceAll(".", "\\.")};?[\\t ]*\\r?\\n`, "gm"), "")
    .replace(/^[\t ]*registerPlugin\s*\(\s*JarvisContextPlugin(?:\.class|::class\.java)\s*\)\s*;?[\t ]*\r?\n/gm, "");
  if (/registerPlugin\s*\(\s*JarvisContextPlugin/.test(output)) {
    diagnostic(`could not remove legacy JarvisContext manual registration in ${path}`);
  }
  return output;
}

function androidPaths(mobileDir, pluginDir) {
  const androidDir = join(mobileDir, "android");
  requiredDirectory(androidDir, "generated Android tree; run npx cap add android first");
  for (const [path, purpose] of [
    [join(androidDir, "settings.gradle"), "Android settings.gradle"],
    [join(androidDir, "capacitor.settings.gradle"), "Capacitor-generated Android settings"],
    [join(androidDir, "app", "build.gradle"), "Android app build.gradle"],
    [join(androidDir, "app", "capacitor.build.gradle"), "Capacitor-generated Android dependencies"],
    [join(androidDir, "app", "src", "main", "AndroidManifest.xml"), "Android main manifest"],
    [join(pluginDir, "android", "build.gradle"), "JarvisContext Android project"],
    [join(pluginDir, "android", "src", "main", "AndroidManifest.xml"), "JarvisContext Android manifest"],
    [join(pluginDir, "android", "src", "main", "java", "chat", "jarvis", "context", "JarvisContextPlugin.kt"), "JarvisContext Android plugin"],
  ]) requiredFile(path, purpose);
  return {
    androidDir,
    settings: join(androidDir, "settings.gradle"),
    capacitorSettings: join(androidDir, "capacitor.settings.gradle"),
    appGradle: join(androidDir, "app", "build.gradle"),
    capacitorGradle: join(androidDir, "app", "capacitor.build.gradle"),
    mainManifest: join(androidDir, "app", "src", "main", "AndroidManifest.xml"),
    mainResourceXml: join(androidDir, "app", "src", "main", "res", "xml"),
    storeManifest: join(androidDir, "app", "src", "store", "AndroidManifest.xml"),
    sideloadManifest: join(androidDir, "app", "src", "sideload", "AndroidManifest.xml"),
    mainActivity: findMainActivity(androidDir),
  };
}

function applyAndroid(mobileDir, pluginDir, changedFiles, paths = androidPaths(mobileDir, pluginDir)) {
  patchFile(paths.settings, removeLegacyAndroidSettingsLink, changedFiles);
  patchFile(
    paths.appGradle,
    (text, path) => removeLegacyAndroidDependency(ensureAndroidFlavors(text, path)),
    changedFiles,
  );
  patchFile(
    paths.mainManifest,
    (text, path) => patchAndroidBackupConfiguration(
      patchMainManifest(text, path),
      path,
      paths.mainResourceXml,
      changedFiles,
    ),
    changedFiles,
  );
  patchFile(paths.mainActivity, patchMainActivity, changedFiles);
  createOrPatch(paths.storeManifest, storeManifestTemplate(), patchStoreManifest, changedFiles);
  createOrPatch(paths.sideloadManifest, sideloadManifestTemplate(), patchSideloadManifest, changedFiles);
  verifyAndroidTransformOutput(paths, changedFiles);
}

function findSwiftArray(text, anchor, path, fromIndex = 0) {
  const anchorIndex = text.indexOf(anchor, fromIndex);
  if (anchorIndex < 0) diagnostic(`missing ${anchor} anchor in ${path}`);
  const open = text.indexOf("[", anchorIndex + anchor.length);
  if (open < 0) diagnostic(`missing [ after ${anchor} in ${path}`);
  return { open, close: matchingDelimiter(text, open, "[", "]", path) };
}

function appendSwiftArrayEntry(text, block, entry) {
  const eol = eolOf(text);
  const closingIndent = lineIndentAt(text, block.close);
  const childIndent = `${closingIndent}    `;
  let prefix = text.slice(0, block.close).replace(/[\t ]*$/, "");
  const lastNonWhitespace = prefix.search(/\S(?=\s*$)/);
  if (lastNonWhitespace >= 0 && prefix[lastNonWhitespace] !== "[" && prefix[lastNonWhitespace] !== ",") {
    prefix = `${prefix.slice(0, lastNonWhitespace + 1)},${prefix.slice(lastNonWhitespace + 1)}`;
  }
  return `${prefix}${eol}${childIndent}${entry}${eol}${text.slice(block.close)}`;
}

function patchCapAppPackage(text, path, pluginPath) {
  let output = text;
  const existingPackage = /\.package\(name:\s*"JarvisContext",\s*path:\s*"[^"]*"\)/.exec(output);
  if (existingPackage) {
    output = output.replace(
      existingPackage[0],
      `.package(name: "JarvisContext", path: "${pluginPath}")`,
    );
  } else {
    const dependencies = findSwiftArray(output, "dependencies:", path);
    output = appendSwiftArrayEntry(
      output,
      dependencies,
      `.package(name: "JarvisContext", path: "${pluginPath}") // jarvis-context`,
    );
  }
  if (!output.includes('.product(name: "JarvisContext"')) {
    const target = output.indexOf('name: "CapApp-SPM"', output.indexOf("targets:"));
    if (target < 0) diagnostic(`missing CapApp-SPM target in ${path}`);
    const dependencies = findSwiftArray(output, "dependencies:", path, target);
    output = appendSwiftArrayEntry(
      output,
      dependencies,
      '.product(name: "JarvisContext", package: "JarvisContext") // jarvis-context',
    );
  }
  return output;
}

function patchPodfile(text, path, pluginPath) {
  if (/pod\s+['"]JarvisContext['"]/.test(text)) return text;
  const target = /target\s+['"]App['"]\s+do\s*$\s*/m.exec(text);
  if (!target) diagnostic(`missing target 'App' do anchor in ${path}`);
  const insert = target.index + target[0].length;
  const eol = eolOf(text);
  return `${text.slice(0, insert)}  pod 'JarvisContext', :path => '${pluginPath}' # jarvis-context${eol}${text.slice(insert)}`;
}

function ensurePlistString(text, key, value, path) {
  if (text.includes(`<key>${key}</key>`)) return text;
  const marker = "</dict>";
  const index = text.lastIndexOf(marker);
  if (index < 0) diagnostic(`missing </dict> in ${path}`);
  const eol = eolOf(text);
  return `${text.slice(0, index)}\t<key>${key}</key>${eol}\t<string>${value}</string>${eol}${text.slice(index)}`;
}

function ensurePlistArrayValue(text, key, value, path) {
  const keyMarker = `<key>${key}</key>`;
  const keyIndex = text.indexOf(keyMarker);
  const eol = eolOf(text);
  if (keyIndex < 0) {
    const dictClose = text.lastIndexOf("</dict>");
    if (dictClose < 0) diagnostic(`missing </dict> in ${path}`);
    return `${text.slice(0, dictClose)}\t${keyMarker}${eol}\t<array>${eol}\t\t<string>${value}</string>${eol}\t</array>${eol}${text.slice(dictClose)}`;
  }
  const arrayOpen = text.indexOf("<array>", keyIndex + keyMarker.length);
  if (arrayOpen < 0) diagnostic(`${key} is not an array in ${path}`);
  const arrayClose = text.indexOf("</array>", arrayOpen);
  if (arrayClose < 0) diagnostic(`unterminated ${key} array in ${path}`);
  if (text.slice(arrayOpen, arrayClose).includes(`<string>${value}</string>`)) return text;
  return `${text.slice(0, arrayClose)}\t\t<string>${value}</string>${eol}${text.slice(arrayClose)}`;
}

function removePlistArrayValue(text, key, value, path) {
  const keyMarker = `<key>${key}</key>`;
  const keyIndex = text.indexOf(keyMarker);
  if (keyIndex < 0) return text;
  const arrayOpen = text.indexOf("<array>", keyIndex + keyMarker.length);
  if (arrayOpen < 0) diagnostic(`${key} is not an array in ${path}`);
  const arrayClose = text.indexOf("</array>", arrayOpen);
  if (arrayClose < 0) diagnostic(`unterminated ${key} array in ${path}`);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = text.slice(arrayOpen + "<array>".length, arrayClose)
    .replace(new RegExp(`\\s*<string>\\s*${escaped}\\s*</string>`, "g"), "");
  const rebuilt = `${text.slice(0, arrayOpen + "<array>".length)}${body}${text.slice(arrayClose)}`;
  const newArrayClose = rebuilt.indexOf("</array>", arrayOpen);
  const remaining = rebuilt.slice(arrayOpen, newArrayClose);
  if (/<string>/.test(remaining)) return rebuilt;
  let end = newArrayClose + "</array>".length;
  while (end < rebuilt.length && /[\t \r\n]/.test(rebuilt[end])) end += 1;
  return `${rebuilt.slice(0, keyIndex)}${rebuilt.slice(end)}`;
}

function patchInfoPlist(text, path, iosBackgroundMode) {
  let output = text;
  const descriptions = [
    ["NSLocationWhenInUseUsageDescription", "Jarvis uses your location only when you request nearby context."],
    ["NSLocationAlwaysAndWhenInUseUsageDescription", "Jarvis uses background location only for geofence arrival and departure events you enable."],
    ["NSCalendarsFullAccessUsageDescription", "Jarvis reads calendar times to produce busy intervals without event details."],
    ["NSCalendarsUsageDescription", "Jarvis reads calendar times to produce busy intervals without event details."],
  ];
  for (const [key, value] of descriptions) output = ensurePlistString(output, key, value, path);
  return iosBackgroundMode
    ? ensurePlistArrayValue(output, "UIBackgroundModes", "location", path)
    : removePlistArrayValue(output, "UIBackgroundModes", "location", path);
}

function patchStoryboard(text, path) {
  const legacy = 'customClass="JarvisContextBridgeViewController" customModule="JarvisContext"';
  if (text.includes(legacy)) {
    return text.replace(
      legacy,
      'customClass="CAPBridgeViewController" customModule="Capacitor"',
    );
  }
  const original = 'customClass="CAPBridgeViewController" customModule="Capacitor"';
  if (text.includes(original)) return text;
  diagnostic(`Main.storyboard uses an unsupported custom bridge controller: ${path}`);
}

function patchBackgroundCapability(text, path, shouldEnable) {
  if (!shouldEnable && !text.includes("com.apple.BackgroundModes")) return text;
  const target = /([A-Fa-f0-9]{24}) \/\* App \*\/ = \{\s*\n\s*isa = PBXNativeTarget;/.exec(text);
  if (!target) diagnostic(`missing App PBXNativeTarget in ${path}`);
  const targetAttributesIndex = text.indexOf("TargetAttributes = {");
  if (targetAttributesIndex < 0) diagnostic(`missing TargetAttributes in ${path}`);
  const targetAttributesOpen = text.indexOf("{", targetAttributesIndex);
  const targetAttributesClose = matchingDelimiter(text, targetAttributesOpen, "{", "}", path);
  const targetEntryPattern = new RegExp(`\\b${target[1]}\\s*=\\s*\\{`, "g");
  targetEntryPattern.lastIndex = targetAttributesOpen + 1;
  const targetEntry = targetEntryPattern.exec(text);
  if (!targetEntry || targetEntry.index >= targetAttributesClose) {
    diagnostic(`missing App target attributes in ${path}`);
  }
  const appOpen = text.indexOf("{", targetEntry.index);
  const appClose = matchingDelimiter(text, appOpen, "{", "}", path);
  const eol = eolOf(text);

  const systemIndex = text.indexOf("SystemCapabilities = {", appOpen + 1);
  if (systemIndex >= 0 && systemIndex < appClose) {
    const systemOpen = text.indexOf("{", systemIndex);
    const systemClose = matchingDelimiter(text, systemOpen, "{", "}", path);
    const backgroundPattern = /com\.apple\.BackgroundModes\s*=\s*\{/g;
    backgroundPattern.lastIndex = systemOpen + 1;
    const background = backgroundPattern.exec(text);
    if (background && background.index < systemClose) {
      const backgroundOpen = text.indexOf("{", background.index);
      const backgroundClose = matchingDelimiter(text, backgroundOpen, "{", "}", path);
      const block = text.slice(backgroundOpen + 1, backgroundClose);
      const enabledValue = /\benabled\s*=\s*([01])\s*;/.exec(block);
      const desired = shouldEnable ? "1" : "0";
      if (enabledValue?.[1] === desired) return text;
      if (enabledValue) {
        const valueIndex = backgroundOpen + 1 + enabledValue.index + enabledValue[0].indexOf(enabledValue[1]);
        return `${text.slice(0, valueIndex)}${desired}${text.slice(valueIndex + 1)}`;
      }
      if (!shouldEnable) return text;
      const indent = `${lineIndentAt(text, backgroundClose)}\t`;
      return `${text.slice(0, backgroundClose).replace(/[\t ]*$/, "")}${eol}` +
        `${indent}enabled = 1;${eol}${text.slice(backgroundClose)}`;
    }
    if (!shouldEnable) return text;
    const indent = `${lineIndentAt(text, systemClose)}\t`;
    const capability = [
      "com.apple.BackgroundModes = {",
      "\tenabled = 1;",
      "};",
    ].map((line) => `${indent}${line}`).join(eol);
    return `${text.slice(0, systemClose).replace(/[\t ]*$/, "")}${eol}` +
      `${capability}${eol}${text.slice(systemClose)}`;
  }

  if (!shouldEnable) return text;

  const indent = `${lineIndentAt(text, appClose)}\t`;
  const block = [
    "SystemCapabilities = {",
    "\tcom.apple.BackgroundModes = {",
    "\t\tenabled = 1;",
    "\t};",
    "};",
  ].map((line) => `${indent}${line}`).join(eol);
  return `${text.slice(0, appClose).replace(/[\t ]*$/, "")}${eol}${block}${eol}${text.slice(appClose)}`;
}

function iosPaths(mobileDir, pluginDir) {
  const iosDir = join(mobileDir, "ios");
  requiredDirectory(iosDir, "generated iOS tree; run npx cap add ios first");
  const appDir = join(iosDir, "App");
  const packageSwift = join(appDir, "CapApp-SPM", "Package.swift");
  const podfile = join(appDir, "Podfile");
  const hasSpm = existsSync(packageSwift);
  const hasPods = existsSync(podfile);
  if (hasSpm && hasPods) {
    diagnostic(`ambiguous generated iOS tree contains both SwiftPM and CocoaPods entrypoints: ${appDir}`);
  }
  const packageManager = hasSpm ? "spm" : hasPods ? "pods" : "";
  if (!packageManager) {
    diagnostic(`missing CapApp-SPM/Package.swift or Podfile under ${appDir}`);
  }
  for (const [path, purpose] of [
    [join(appDir, "App", "Info.plist"), "iOS Info.plist"],
    [join(appDir, "App", "capacitor.config.json"), "Capacitor-generated iOS config"],
    [join(appDir, "App", "Base.lproj", "Main.storyboard"), "iOS Main.storyboard"],
    [join(appDir, "App.xcodeproj", "project.pbxproj"), "iOS Xcode project"],
    [join(pluginDir, "Package.swift"), "JarvisContext Swift package"],
    [join(pluginDir, "ios", "Sources", "JarvisContext", "JarvisContextPlugin.swift"), "JarvisContext iOS plugin"],
  ]) requiredFile(path, purpose);
  return {
    iosDir,
    appDir,
    packageManager,
    packageSwift,
    podfile,
    infoPlist: join(appDir, "App", "Info.plist"),
    capacitorConfig: join(appDir, "App", "capacitor.config.json"),
    storyboard: join(appDir, "App", "Base.lproj", "Main.storyboard"),
    pbxproj: join(appDir, "App.xcodeproj", "project.pbxproj"),
  };
}

function verifyPluginSource(pluginDir) {
  const privacyPath = requiredFile(
    join(pluginDir, "ios", "Sources", "JarvisContext", "PrivacyInfo.xcprivacy"),
    "JarvisContext privacy manifest",
  );
  const packagePath = requiredFile(join(pluginDir, "Package.swift"), "JarvisContext Swift package");
  const podspecPath = requiredFile(join(pluginDir, "JarvisContext.podspec"), "JarvisContext podspec");
  const privacy = readFileSync(privacyPath, "utf8");
  for (const name of ["plist", "dict", "array", "key", "string"]) xmlElements(privacy, name, privacyPath);
  if (xmlElements(privacy, "plist", privacyPath).length !== 1 ||
      !/<key>\s*NSPrivacyTracking\s*<\/key>\s*<false\s*\/>/.test(privacy) ||
      !/<key>\s*NSPrivacyCollectedDataTypes\s*<\/key>\s*<array\s*\/>/.test(privacy) ||
      !/NSPrivacyAccessedAPICategoryUserDefaults/.test(privacy) ||
      !/<string>\s*CA92\.1\s*<\/string>/.test(privacy)) {
    diagnostic(`JarvisContext privacy manifest has an unsupported schema: ${privacyPath}`);
  }
  if (!/\.process\(\s*["']PrivacyInfo\.xcprivacy["']\s*\)/.test(readFileSync(packagePath, "utf8"))) {
    diagnostic(`SwiftPM does not package PrivacyInfo.xcprivacy: ${packagePath}`);
  }
  if (!/resource_bundles[\s\S]*PrivacyInfo\.xcprivacy/.test(readFileSync(podspecPath, "utf8"))) {
    diagnostic(`CocoaPods does not package PrivacyInfo.xcprivacy: ${podspecPath}`);
  }
  const legacyBridge = join(
    pluginDir,
    "ios",
    "Sources",
    "JarvisContext",
    "JarvisContextBridgeViewController.swift",
  );
  if (existsSync(legacyBridge)) diagnostic(`legacy iOS bridge entrypoint must be removed: ${legacyBridge}`);

  const definitionsPath = requiredFile(join(pluginDir, "definitions.ts"), "JarvisContext TypeScript contract");
  const androidPluginPath = requiredFile(
    join(pluginDir, "android", "src", "main", "java", "chat", "jarvis", "context", "JarvisContextPlugin.kt"),
    "JarvisContext Android plugin",
  );
  const androidStorePath = requiredFile(
    join(pluginDir, "android", "src", "main", "java", "chat", "jarvis", "context", "JarvisContextStore.kt"),
    "JarvisContext Android store",
  );
  const androidCoordinatorPath = requiredFile(
    join(pluginDir, "android", "src", "main", "java", "chat", "jarvis", "context", "JarvisContextGeofenceCoordinator.kt"),
    "JarvisContext Android coordinator",
  );
  const androidUploaderPath = requiredFile(
    join(pluginDir, "android", "src", "main", "java", "chat", "jarvis", "context", "JarvisContextTransitionUploader.kt"),
    "JarvisContext Android transition worker",
  );
  const iosPluginPath = requiredFile(
    join(pluginDir, "ios", "Sources", "JarvisContext", "JarvisContextPlugin.swift"),
    "JarvisContext iOS plugin",
  );
  const iosStorePath = requiredFile(
    join(pluginDir, "ios", "Sources", "JarvisContext", "JarvisContextStore.swift"),
    "JarvisContext iOS store",
  );
  const definitions = readFileSync(definitionsPath, "utf8");
  const androidPlugin = readFileSync(androidPluginPath, "utf8");
  const androidStore = readFileSync(androidStorePath, "utf8");
  const androidCoordinator = readFileSync(androidCoordinatorPath, "utf8");
  const androidUploader = readFileSync(androidUploaderPath, "utf8");
  const iosPlugin = readFileSync(iosPluginPath, "utf8");
  const iosStore = readFileSync(iosStorePath, "utf8");
  const androidErase = /private fun eraseAllBlocking[\s\S]*?(?=\n    private fun reconcileSerialized)/.exec(androidCoordinator)?.[0] ?? "";
  const iosErase = /@objc func eraseAll[\s\S]*?(?=\n    \/\*\* Non-destructive)/.exec(iosPlugin)?.[0] ?? "";

  for (const method of ["leaseTransitions", "ackTransitions", "eraseAll"]) {
    if (!new RegExp(`\\b${method}\\s*\\(`).test(definitions) ||
        !new RegExp(`@PluginMethod\\s+fun\\s+${method}\\s*\\(`).test(androidPlugin) ||
        !new RegExp(`CAPPluginMethod\\(name:\\s*["']${method}["']`).test(iosPlugin) ||
        !new RegExp(`@objc\\s+func\\s+${method}\\s*\\(`).test(iosPlugin)) {
      diagnostic(`durable context method ${method} is not exposed consistently by TypeScript, Android, and iOS`);
    }
  }
  if (!/interface\s+JarvisContextScope[\s\S]*principalId[\s\S]*deviceId[\s\S]*generation/.test(definitions) ||
      !/JarvisContextScope/.test(androidStore) || !/JarvisContextScope/.test(iosStore) ||
      !/data\.opt\("principalId"\) as\? String[\s\S]*data\.opt\("generation"\) as\? Number/.test(androidPlugin)) {
    diagnostic("JarvisContext scope must bind principal, device, and authorization generation on every platform");
  }
  if (/\bfun\s+drainTransitions\s*\(/.test(androidStore) || /\bfunc\s+drainTransitions\s*\(/.test(iosStore) ||
      /next\.transitions\.removeFirst/.test(iosStore)) {
    diagnostic("JarvisContext stores must not destructively drain unacknowledged transitions");
  }
  if (!/fun\s+leaseTransitions[\s\S]*leaseTransitionBatch/.test(androidStore) ||
      !/fun\s+acknowledgeTransitions[\s\S]*acknowledgeTransitionBatch/.test(androidStore) ||
      !/func\s+leaseTransitions[\s\S]*leaseTransitionBatch/.test(iosStore) ||
      !/func\s+acknowledgeTransitions[\s\S]*acknowledgeTransitionBatch/.test(iosStore)) {
    diagnostic("JarvisContext durable lease/ACK state machine is incomplete");
  }
  if (!/scopeChanged[\s\S]*transitions\s*=\s*if \(scopeChanged\) emptyList\(\)[\s\S]*acknowledgements\s*=\s*if \(scopeChanged\) emptyList\(\)/.test(androidStore) ||
      !/if scopeChanged \{[\s\S]*next\.transitions\s*=\s*\[\][\s\S]*next\.acknowledgements\s*=\s*\[\]/.test(iosStore)) {
    diagnostic("adopting an authenticated JarvisContext scope must discard ambiguous unscoped delivery state");
  }
  if (!/JarvisContextStore\(context, migrateLegacy = false\)[\s\S]*store\.eraseAll\(scope\)[\s\S]*cancelAllBlocking[\s\S]*removeAllBestEffort/.test(androidCoordinator) ||
      !/atomicFile\.delete\(\)/.test(androidStore) ||
      !/writeState\(State\(scope = expectedScope\)\)/.test(androidStore) ||
      !/migrationError\s*=\s*runCatching\s*\{\s*migrateLegacyState\(\)\s*\}\.exceptionOrNull\(\)/.test(androidStore) ||
      !/cancelAllWorkByTag/.test(androidUploader) ||
      !/expectedGeneration\s*=\s*input\.configurationGeneration/.test(androidUploader)) {
    diagnostic("Android erase must be local-first and cancel generation-bound transition/rearm work");
  }
  if (!/KEY_SCOPE_IDENTITY/.test(androidUploader) || /KEY_(?:PRINCIPAL_ID|DEVICE_ID)/.test(androidUploader)) {
    diagnostic("Android transition work must bind an opaque scope fingerprint without raw principal/device ids");
  }
  if (!androidErase || /finePermissionGranted|backgroundPermissionGranted|requireRegistrationAvailable/.test(androidErase)) {
    diagnostic("Android eraseAll must remain callable without current location permission");
  }
  if (!/contextStore\.eraseAll\(expectedScope:\s*scope\)[\s\S]*stopManagedRegions\(\)/.test(iosPlugin) ||
      !/removeItem\(at:\s*directoryURL\)/.test(iosStore) ||
      !/tombstone\.scope\s*=\s*expectedScope[\s\S]*persist\(tombstone\)/.test(iosStore)) {
    diagnostic("iOS erase must delete protected storage before stopping Jarvis-managed monitoring");
  }
  if (/state\.transitions\.count\s*>=\s*jarvisContextMaximumTransitions/.test(iosStore)) {
    diagnostic("iOS must persist every accepted CoreLocation transition until Hub ACK");
  }
  if (!iosErase || /authorizationStatus|authorizedAlways/.test(iosErase)) {
    diagnostic("iOS eraseAll must remain callable without current location permission");
  }
}

function plistHasBackgroundModes(text, path) {
  const key = "<key>UIBackgroundModes</key>";
  const keyIndex = text.indexOf(key);
  if (keyIndex < 0) return false;
  const open = text.indexOf("<array>", keyIndex + key.length);
  const close = open >= 0 ? text.indexOf("</array>", open) : -1;
  if (open < 0 || close < 0) diagnostic(`UIBackgroundModes is malformed in ${path}`);
  return /<string>[\s\S]*?<\/string>/.test(text.slice(open, close));
}

function applyIos(
  mobileDir,
  pluginDir,
  changedFiles,
  paths = iosPaths(mobileDir, pluginDir),
  iosBackgroundMode = false,
) {
  if (paths.packageManager === "spm") {
    const pluginPath = normalizeRelative(dirname(paths.packageSwift), pluginDir);
    patchFile(paths.packageSwift, (text, path) => patchCapAppPackage(text, path, pluginPath), changedFiles);
  } else {
    const pluginPath = normalizeRelative(dirname(paths.podfile), pluginDir);
    patchFile(paths.podfile, (text, path) => patchPodfile(text, path, pluginPath), changedFiles);
  }
  const plistBefore = readFileSync(paths.infoPlist, "utf8");
  const plistAfter = patchInfoPlist(plistBefore, paths.infoPlist, iosBackgroundMode);
  stageChanged(paths.infoPlist, plistBefore, plistAfter, changedFiles);
  patchFile(paths.storyboard, patchStoryboard, changedFiles);
  const hasBackgroundModes = plistHasBackgroundModes(plistAfter, paths.infoPlist);
  patchFile(
    paths.pbxproj,
    (text, path) => patchBackgroundCapability(text, path, hasBackgroundModes),
    changedFiles,
  );
  let config;
  try {
    config = JSON.parse(readFileSync(paths.capacitorConfig, "utf8"));
  } catch (error) {
    diagnostic(`invalid Capacitor iOS config ${paths.capacitorConfig}: ${error.message}`);
  }
  const classes = Array.isArray(config.packageClassList) ? config.packageClassList : [];
  if (classes.filter((name) => name === "JarvisContextPlugin").length !== 1 ||
      classes.includes("JarvisContextBridgeViewController")) {
    diagnostic(`Capacitor iOS discovery must contain exactly one JarvisContextPlugin in ${paths.capacitorConfig}`);
  }
}

export function applyContextNative({
  mobileDir = DEFAULT_MOBILE_DIR,
  pluginDir = join(mobileDir, "plugins", "jarvis-context"),
  platform = "all",
  iosBackgroundMode = false,
} = {}) {
  const resolvedMobile = resolve(mobileDir);
  const resolvedPlugin = resolve(pluginDir);
  if (!new Set(["android", "ios", "all", "generated"]).has(platform)) {
    diagnostic(`platform must be android, ios, all, or generated; received ${platform}`);
  }
  requiredDirectory(resolvedPlugin, "JarvisContext plugin directory");
  verifyPluginSource(resolvedPlugin);

  // Preflight every requested platform before changing either generated tree.
  const wantsGenerated = platform === "generated";
  const android = platform === "android" || platform === "all" ||
      (wantsGenerated && existsSync(join(resolvedMobile, "android")))
    ? androidPaths(resolvedMobile, resolvedPlugin)
    : null;
  const ios = platform === "ios" || platform === "all" ||
      (wantsGenerated && existsSync(join(resolvedMobile, "ios")))
    ? iosPaths(resolvedMobile, resolvedPlugin)
    : null;
  if (wantsGenerated && !android && !ios) {
    diagnostic(`no generated Android or iOS tree exists under ${resolvedMobile}`);
  }
  const stagedFiles = new Map();
  if (android) applyAndroid(resolvedMobile, resolvedPlugin, stagedFiles, android);
  if (ios) applyIos(resolvedMobile, resolvedPlugin, stagedFiles, ios, iosBackgroundMode);
  const changedFiles = [...stagedFiles.keys()];
  for (const [path, content] of stagedFiles) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return { platform, changedFiles };
}

function installPodsIfNeeded(mobileDir) {
  const appDir = join(resolve(mobileDir), "ios", "App");
  const podfile = join(appDir, "Podfile");
  const packageSwift = join(appDir, "CapApp-SPM", "Package.swift");
  if (!existsSync(podfile) && !existsSync(packageSwift)) return false;
  if (existsSync(podfile) && existsSync(packageSwift)) {
    diagnostic(`cannot finalize an ambiguous iOS tree with both SwiftPM and CocoaPods: ${appDir}`);
  }
  if (!existsSync(podfile)) return false;
  if (process.platform !== "darwin") {
    diagnostic(`CocoaPods dependency finalization requires macOS: ${appDir}`);
  }
  const result = spawnSync("pod", ["install"], { cwd: appDir, stdio: "inherit" });
  if (result.error) diagnostic(`could not run pod install in ${appDir}: ${result.error.message}`);
  if (result.status !== 0) diagnostic(`pod install failed with exit code ${result.status} in ${appDir}`);
  return true;
}

function parseCli(argv) {
  let platform = "all";
  let mobileDir = DEFAULT_MOBILE_DIR;
  let iosBackgroundMode = false;
  let installPods = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) diagnostic("--root requires a mobile directory");
      mobileDir = resolve(value);
      index += 1;
    } else if (["android", "ios", "all", "generated"].includes(argument)) {
      platform = argument;
    } else if (argument === "--ios-background-mode") {
      iosBackgroundMode = true;
    } else if (argument === "--install-pods-if-needed") {
      installPods = true;
    } else {
      diagnostic(`unknown argument: ${argument}`);
    }
  }
  return { platform, mobileDir, iosBackgroundMode, installPods };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_FILE)) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = applyContextNative(options);
    const installedPods = options.installPods ? installPodsIfNeeded(options.mobileDir) : false;
    const detail = result.changedFiles.length
      ? `updated ${result.changedFiles.length} file(s)`
      : "already up to date";
    const pods = installedPods ? "; CocoaPods installed" : "";
    console.log(`[context-native] applied ${result.platform}: ${detail}${pods}`);
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  }
}
