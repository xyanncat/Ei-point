const CYRENE_PERSONA_MAX_BYTES = 16 * 1024;
const CYRENE_CHAT_SECTIONS = new Set(["1", "2", "3", "4", "5", "6", "7", "9", "10"]);
/** Behavioural sections first; canon lore is the first thing to give way when the
 *  documented 16 KiB prompt bound is tight. */
const SECTION_PRIORITY = ["1", "5", "6", "9", "10", "2", "3", "7", "4"];

/** Keep the supplied chat persona, while leaving sample replies and reference links out of every request. */
export function prepareCyrenePersonaPrompt(memory: string): string {
  const headings = [...memory.matchAll(/^## (\d+)\. [^\r\n]+/gm)];
  const sections = new Map<string, string>();
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!;
    const sectionNumber = heading[1];
    if (!sectionNumber || !CYRENE_CHAT_SECTIONS.has(sectionNumber) || sections.has(sectionNumber)) continue;
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? memory.length;
    sections.set(sectionNumber, memory.slice(start, end).trim());
  }
  const missing = [...CYRENE_CHAT_SECTIONS].filter((section) => !sections.has(section));
  if (missing.length) {
    throw new Error("Cyrene persona memory is missing a required chat section");
  }

  const parts: string[] = [];
  let used = 0;
  const append = (text: string): boolean => {
    const separator = parts.length ? 2 : 0;
    const remaining = CYRENE_PERSONA_MAX_BYTES - used - separator;
    if (remaining <= 0) return false;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= remaining) {
      parts.push(text);
      used += bytes + separator;
      return true;
    }
    // Bounded truncation at a UTF-8 safe boundary, leaving room for the ellipsis.
    let slice = text.slice(0, Math.max(0, remaining - 3));
    while (slice && Buffer.byteLength(slice, "utf8") > remaining - 3) slice = slice.slice(0, -1);
    const trimmed = slice.trimEnd();
    if (trimmed) {
      parts.push(`${trimmed}…`);
      used += Buffer.byteLength(trimmed, "utf8") + 3 + separator;
    }
    return false;
  };

  const firstSectionStart = headings[0]?.index ?? 0;
  const preface = memory.slice(0, firstSectionStart).trim();
  if (preface) append(preface);
  for (const sectionNumber of SECTION_PRIORITY) {
    if (!append(sections.get(sectionNumber)!)) break;
  }
  const prompt = parts.join("\n\n");
  if (!prompt.trim()) throw new Error("Cyrene persona memory is empty");
  return prompt;
}
