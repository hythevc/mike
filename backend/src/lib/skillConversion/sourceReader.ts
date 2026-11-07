// SPDX-License-Identifier: AGPL-3.0-only
//
// Reading an upstream skill folder as untrusted data. Every byte that comes
// from the source list is read here, where the dangerous shapes are refused
// before anything looks at the content: symlinks, hard links, absolute or
// '..' paths, files over 5 MB and non-UTF-8 text. Frontmatter and manifest
// YAML are parsed with a safe loader (core schema, a 64 KB cap), because the
// source is fetched from a public list and must never steer the build.

import { lstat, readFile, readdir } from "fs/promises";
import path from "path";
import { parse as parseYaml } from "yaml";

const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_YAML_BYTES = 64 * 1024;

/** A refusal that names the skill and the file it came from. */
export class SkillConversionError extends Error {
  constructor(
    readonly skill: string,
    readonly file: string | null,
    message: string,
  ) {
    super(
      file
        ? `Skill '${skill}', file '${file}': ${message}`
        : `Skill '${skill}': ${message}`,
    );
    this.name = "SkillConversionError";
  }
}

export type SourceFile = {
  /** Path relative to the skill folder, with '/' separators. */
  path: string;
  bytes: Buffer;
};

export type SkillSource = {
  /** The skill's folder name under the source `skills/` directory. */
  folder: string;
  /** Every regular file in the folder, keyed by its relative path. */
  files: Map<string, SourceFile>;
};

function utf8Text(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

/**
 * Read one skill folder (`<rootDir>/<folder>`), refusing anything that could
 * change meaning on the way into the catalog. Directories are walked without
 * following links; a symlink anywhere in the tree is refused.
 */
export async function readSkillSource(
  rootDir: string,
  folder: string,
): Promise<SkillSource> {
  const base = path.join(rootDir, folder);
  const files = new Map<string, SourceFile>();

  async function walk(directory: string, relative: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    // Sort so the walk order is stable regardless of the filesystem.
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        throw new SkillConversionError(
          folder,
          relPath,
          "is a symlink; workflow source files must be regular files",
        );
      }
      if (stat.isDirectory()) {
        await walk(full, relPath);
        continue;
      }
      if (!stat.isFile()) {
        throw new SkillConversionError(
          folder,
          relPath,
          "is not a regular file; workflow source files must be regular files",
        );
      }
      if (stat.nlink > 1) {
        throw new SkillConversionError(
          folder,
          relPath,
          "is a hard link (more than one name points at it); workflow source " +
            "files must be regular files",
        );
      }
      if (stat.size > MAX_SOURCE_FILE_BYTES) {
        throw new SkillConversionError(
          folder,
          relPath,
          `is ${stat.size} bytes, over the 5 MB per-file limit`,
        );
      }
      files.set(relPath, { path: relPath, bytes: await readFile(full) });
    }
  }

  const baseStat = await lstat(base).catch(() => null);
  if (!baseStat) {
    throw new SkillConversionError(folder, null, "source folder was not found");
  }
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory()) {
    throw new SkillConversionError(
      folder,
      null,
      "source folder must be a real directory, not a link",
    );
  }
  await walk(base, "");
  return { folder, files };
}

/**
 * A source path named in the manifest, resolved to its file inside the skill
 * folder. Absolute paths and any path that escapes the folder with '..' are
 * refused, as is a missing file.
 */
export function resolveSourceFile(
  source: SkillSource,
  skillKey: string,
  fromPath: string,
): SourceFile {
  if (!fromPath || path.isAbsolute(fromPath) || /^[A-Za-z]:/.test(fromPath)) {
    throw new SkillConversionError(
      skillKey,
      fromPath || "(empty)",
      "is an absolute path; reference paths must stay inside the skill folder",
    );
  }
  const normalized = path.posix.normalize(fromPath.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || normalized.split("/").includes("..")) {
    throw new SkillConversionError(
      skillKey,
      fromPath,
      "escapes the skill folder with '..'; reference paths must stay inside it",
    );
  }
  const file = source.files.get(normalized.replace(/^\.\//, ""));
  if (!file) {
    throw new SkillConversionError(
      skillKey,
      fromPath,
      "was named in the manifest but is not in the skill folder",
    );
  }
  return file;
}

/** The UTF-8 text of a source file, or a refusal naming the skill and file. */
export function sourceText(
  source: SkillSource,
  skillKey: string,
  relPath: string,
): string {
  const file = source.files.get(relPath);
  if (!file) {
    throw new SkillConversionError(
      skillKey,
      relPath,
      "was expected but is not in the skill folder",
    );
  }
  const text = utf8Text(file.bytes);
  if (text === null) {
    throw new SkillConversionError(
      skillKey,
      relPath,
      "is not valid UTF-8 text",
    );
  }
  return text;
}

/**
 * Parse YAML from an untrusted source: a 64 KB cap, the core schema (no
 * code-bearing or custom tags), and merge keys off. The result is a plain
 * value the caller validates field by field.
 */
export function safeYamlLoad(
  text: string,
  skillKey: string,
  file: string,
): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_YAML_BYTES) {
    throw new SkillConversionError(
      skillKey,
      file,
      "YAML exceeds the 64 KB limit",
    );
  }
  try {
    return parseYaml(text, { schema: "core", merge: false, version: "1.2" });
  } catch (error) {
    throw new SkillConversionError(
      skillKey,
      file,
      `is invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
