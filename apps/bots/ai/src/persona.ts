const CYRENE_PERSONA_MAX_BYTES = 16 * 1024;
const CYRENE_CHAT_SECTIONS = new Set(["1", "2", "3", "4", "5", "6", "7", "9", "10"]);

/** Keep the supplied chat persona, while leaving sample replies and reference links out of every request. */
export function prepareCyrenePersonaPrompt(memory: string): string {
  const headings = [...memory.matchAll(/^## (\d+)\. [^\r\n]+/gm)];
  const selected = headings.flatMap((heading, index) => {
    const sectionNumber = heading[1];
    if (!sectionNumber || !CYRENE_CHAT_SECTIONS.has(sectionNumber)) return [];
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? memory.length;
    return [{ sectionNumber, content: memory.slice(start, end).trim() }];
  });
  const selectedNumbers = new Set(selected.map((section) => section.sectionNumber));
  if (selectedNumbers.size !== CYRENE_CHAT_SECTIONS.size || [...CYRENE_CHAT_SECTIONS].some((section) => !selectedNumbers.has(section))) {
    throw new Error("Cyrene persona memory is missing a required chat section");
  }

  const firstSectionStart = headings[0]?.index ?? 0;
  const preface = memory.slice(0, firstSectionStart).trim();
  const prompt = [preface, ...selected.map((section) => section.content)].filter(Boolean).join("\n\n");
  if (Buffer.byteLength(prompt, "utf8") > CYRENE_PERSONA_MAX_BYTES) {
    throw new Error("Cyrene chat persona exceeds its 16 KiB runtime prompt limit");
  }
  return prompt;
}
