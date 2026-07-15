type JsonRecord = Record<string, unknown>;

type RenderContext = {
  listDepth: number;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function childNodes(node: JsonRecord): unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

function attributes(node: JsonRecord): JsonRecord {
  return asRecord(node.attrs) ?? {};
}

function renderChildren(node: JsonRecord, context: RenderContext): string {
  return childNodes(node)
    .map((child) => renderNode(child, context))
    .join("");
}

function renderBlockChildren(node: JsonRecord, context: RenderContext): string {
  return childNodes(node)
    .map((child) => renderNode(child, context).trimEnd())
    .filter((child) => child !== "")
    .join("\n\n");
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>#!]/g, "\\$&");
}

function inlineCode(text: string): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${text}${fence}`;
}

function applyMarks(text: string, marks: unknown): string {
  if (!Array.isArray(marks)) return escapeMarkdown(text);

  const normalizedMarks = marks.flatMap((markValue) => {
    const mark = asRecord(markValue);
    return mark === undefined ? [] : [mark];
  });
  const hasCodeMark = normalizedMarks.some((mark) => mark.type === "code");

  return normalizedMarks.reduce((rendered, mark) => {
    const attrs = attributes(mark);

    switch (mark.type) {
      case "strong":
        return `**${rendered}**`;
      case "em":
        return `_${rendered}_`;
      case "strike":
        return `~~${rendered}~~`;
      case "code":
        return rendered;
      case "link":
        return typeof attrs.href === "string" ? `[${rendered}](${attrs.href})` : rendered;
      case "underline":
        return `<u>${rendered}</u>`;
      default:
        return rendered;
    }
  }, hasCodeMark ? inlineCode(text) : escapeMarkdown(text));
}

function renderList(node: JsonRecord, ordered: boolean, context: RenderContext): string {
  const attrs = attributes(node);
  const start = ordered && typeof attrs.order === "number" ? attrs.order : 1;
  const indentation = "  ".repeat(context.listDepth);

  return childNodes(node)
    .map((item, index) => {
      const itemRecord = asRecord(item);
      if (itemRecord === undefined) return "";
      const marker = ordered ? `${start + index}.` : "-";
      const rendered = renderNode(itemRecord, { listDepth: context.listDepth + 1 }).trim();
      const lines = rendered.split("\n");
      return `${indentation}${marker} ${(lines[0] ?? "").trimStart()}${lines
        .slice(1)
        .map((line) => line.startsWith("  ") ? `\n${line}` : `\n${indentation}  ${line}`)
        .join("")}`;
    })
    .filter(Boolean)
    .join("\n");
}

function renderTable(node: JsonRecord, context: RenderContext): string {
  const rows = childNodes(node)
    .map((rowValue) => {
      const row = asRecord(rowValue);
      if (row === undefined) return [];
      return childNodes(row).map((cellValue) => {
        const cell = asRecord(cellValue);
        return cell === undefined
          ? ""
          : renderChildren(cell, context).trim().replaceAll("|", "\\|").replaceAll("\n", "<br>");
      });
    })
    .filter((row) => row.length > 0);

  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
  const header = normalized[0];
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderNode(value: unknown, context: RenderContext): string {
  if (typeof value === "string") return value;
  const node = asRecord(value);
  if (node === undefined) return "";
  const attrs = attributes(node);

  switch (node.type) {
    case "doc":
      return renderBlockChildren(node, context);
    case "text":
      return typeof node.text === "string" ? applyMarks(node.text, node.marks) : "";
    case "paragraph":
      return renderChildren(node, context);
    case "hardBreak":
      return "  \n";
    case "heading": {
      const level = typeof attrs.level === "number" && attrs.level >= 1 && attrs.level <= 6
        ? attrs.level
        : 1;
      return `${"#".repeat(level)} ${renderChildren(node, context).trim()}`;
    }
    case "blockquote":
      return renderBlockChildren(node, context)
        .trim()
        .split("\n")
        .map((line) => line === "" ? ">" : `> ${line}`)
        .join("\n");
    case "codeBlock": {
      const language = typeof attrs.language === "string" ? attrs.language : "";
      const content = childNodes(node)
        .map((child) => {
          const childRecord = asRecord(child);
          return typeof childRecord?.text === "string" ? childRecord.text : "";
        })
        .join("");
      const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
      const fence = "`".repeat(Math.max(3, longestRun + 1));
      return `${fence}${language}\n${content}\n${fence}`;
    }
    case "bulletList":
      return renderList(node, false, context);
    case "orderedList":
      return renderList(node, true, context);
    case "listItem":
      return childNodes(node)
        .map((child) => renderNode(child, context))
        .filter((child) => child !== "")
        .join("\n");
    case "table":
      return renderTable(node, context);
    case "tableRow":
    case "tableCell":
    case "tableHeader":
      return renderChildren(node, context);
    case "panel": {
      const panelType = typeof attrs.panelType === "string" ? attrs.panelType.toUpperCase() : "INFO";
      const content = renderBlockChildren(node, context).trim();
      const quotedContent = content
        .split("\n")
        .map((line) => line === "" ? ">" : `> ${line}`)
        .join("\n");
      return `> [!${panelType}]${content === "" ? "" : `\n${quotedContent}`}`;
    }
    case "mention": {
      const text = typeof attrs.text === "string"
        ? attrs.text
        : typeof attrs.displayName === "string"
          ? attrs.displayName
          : typeof attrs.id === "string"
            ? attrs.id
            : "";
      return text === "" || text.startsWith("@") ? text : `@${text}`;
    }
    case "emoji":
      return typeof attrs.text === "string"
        ? attrs.text
        : typeof attrs.shortName === "string"
          ? attrs.shortName
          : "";
    case "inlineCard":
    case "blockCard":
      return typeof attrs.url === "string" ? attrs.url : renderChildren(node, context);
    case "mediaSingle":
    case "mediaGroup":
      return renderBlockChildren(node, context);
    case "media": {
      const label = typeof attrs.alt === "string"
        ? attrs.alt
        : typeof attrs.id === "string"
          ? attrs.id
          : "attachment";
      return typeof attrs.url === "string"
        ? `![${escapeMarkdown(label)}](${attrs.url})`
        : `[media: ${escapeMarkdown(label)}]`;
    }
    case "rule":
      return "---";
    case "status":
      return typeof attrs.text === "string" ? attrs.text : renderChildren(node, context);
    default:
      if (typeof node.text === "string") return node.text;
      return renderChildren(node, context);
  }
}

export function isAdfDocument(value: unknown): boolean {
  const record = asRecord(value);
  return record?.type === "doc" && Array.isArray(record.content);
}

export function adfToMarkdown(value: unknown): string {
  return renderNode(value, { listDepth: 0 }).trim();
}
