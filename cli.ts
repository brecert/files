import {
  deepMerge,
  findLastIndex,
  groupBy,
} from "https://deno.land/std@0.114.0/collections/mod.ts";

import {
  Command,
  Type,
} from "https://deno.land/x/cliffy@v0.20.1/command/mod.ts";

import * as path from "https://deno.land/std@0.114.0/path/mod.ts";

import { ITypeInfo } from "https://deno.land/x/cliffy@v0.20.1/flags/mod.ts";

import { Config } from "./formats/config.ts";
import { Lockfile } from "./formats/lockfile.ts";
import { writeLinks } from "./formats/linkfile.ts";
import { FileDiff, FileType } from "./formats/utils.ts";

const isCommandName = (str: string) => /^[a-z]+$/.test(str);

enum ArgType {
  TagAdd = "tags",
  TagSub = "tags",
  Flag = "flags",
  Other = "_",
}

function getTypeName(arg: string) {
  if (arg.startsWith("+")) return ArgType.TagAdd;
  if (arg.startsWith("--")) return ArgType.Flag;
  if (arg.startsWith("-")) return ArgType.TagSub;
  return ArgType.Other;
}

type Arg = {
  name: string;
  tags: string[];
  _: string[];
};
function _parseArgs([...args]: string[]): Arg[] {
  args.unshift("");
  let idx: number | undefined = args.length;
  const parsed = [];
  do {
    const last = idx;
    idx = findLastIndex(args.slice(0, idx), isCommandName);
    const [name, ...flags] = args.slice(idx, last);
    const other = groupBy(flags.reverse(), getTypeName);
    parsed.push({
      name,
      tags: [],
      _: [],
      ...other,
    });
  } while (idx != undefined && idx > 0);
  return parsed.reverse();
}

enum TagMode {
  Add = "add",
  Remove = "remove",
  // Unknown = "unknown",
}

const MODE: Record<string, TagMode> = {
  "+": TagMode.Add,
  "-": TagMode.Remove,
};

type Tag = {
  mode: TagMode;
  path: string[];
  value: string;
};

function parseTag(tag: string): Tag {
  const mode = MODE[tag[0]];
  tag = tag.slice(1);

  const [path, value] = tag.split(/:/);

  return {
    mode: mode,
    path: path.split("."),
    value: value,
  };
}

class TagType extends Type<Tag> {
  tagRegex = /^[+-](\w+(\.\w+)*)(:.+)?$/;

  parse({ label, name, value }: ITypeInfo) {
    if (!this.tagRegex.test(value)) {
      throw new Error(
        `${label} "${name}" must be a valid "tag", but got "${value}".`,
      );
    }

    return parseTag(value);
  }
}

class URIType extends Type<URL> {
  parse({ label, name, value }: ITypeInfo) {
    try {
      return new URL(value);
    } catch (err) {
      throw new Error(
        `${label} "${name}" must be a valid "uri", but got "${value}".\n${err}`,
      );
    }
  }
}

const res = await Deno.permissions.query({
  name: "env",
  variable: "IMAGES_CONFIG_FILE",
});

if (res.state === "denied") {
  console.debug(`Unabled to read 'IMAGES_CONFIG_FILE' from env`);
}

const canWrite = await Deno.permissions.query({ name: "write" })
  .then((res) => res.state === "granted");

await new Command<void>()
  .type("tag", new TagType(), { global: true })
  .type("uri", new URIType(), { global: true })
  .name("images")
  .version("0.1.0")
  .description("Local image database")
  .env<{ configFile?: string }>(
    "IMAGES_CONFIG_FILE=<value:string>",
    "Path to the images config file. Useful for using the images command from anywhere.",
    { global: true, prefix: "IMAGES_" },
  )
  // command to add new files
  .command<[URL, Tag[]]>(
    "add <uri:uri> [tags...:tag]",
    "Add a new image to the database",
  )
  .example(
    "output json",
    "images add --json https://example.com/image.png +tag",
  )
  .option<{ json: boolean }>("--json", "output json")
  .option<{ dry: boolean }>(
    "--dry",
    "leave the filesystem untouched (network activity and file reads are still expected)",
  )
  .action(async (params, uri, tags) => {
    const configPath = params.configFile ?? "./images.config.json";
    const outputPath = path.dirname(configPath);
    const lockfilePath = path.join(outputPath, "lockfile.json");

    await Deno.permissions.request({ name: "read", path: outputPath });

    const isDry = params.dry || !canWrite;

    if (isDry) {
      console.debug(`running in dry mode`);
    } else {
      await Deno.permissions.request({ name: "write", path: outputPath });
    }

    const config = await Deno.readTextFile(configPath)
      .then(JSON.parse)
      .then(Config.from);

    const lockfile = await Deno.readTextFile(lockfilePath)
      .then(JSON.parse)
      .then((json) => new Lockfile(config, json));

    const res = await config.edit((prev) =>
      deepMerge(prev, {
        files: {
          // todo: clean this mess
          [Date.now()]: {
            source: `${uri}`,
            tags: tags.map((tag) => ({ [tag.path.join(".")]: tag.value })),
          },
        },
      }), { dry: isDry, at: outputPath, lockfile });

    const diff = res.diff();

    if (params.json) {
      console.log(JSON.stringify(diff));
    } else {
      const output = displayFileDiff(diff);
      if (output.length > 0) {
        console.log(output);
      }
    }

    if (!isDry) {
      await Promise.all(
        writeLinks(diff, outputPath),
      );

      await Deno.writeTextFile(configPath, JSON.stringify(res.config));
      await Deno.writeTextFile(
        path.join(outputPath, "lockfile.json"),
        JSON.stringify(res.lockfile),
      );
    }
  })
  .stopEarly()
  // command to remove a file
  .command<[string, Tag[]]>(
    "remove <query:string> [tags...:tag]",
    "Remove queried images from the database",
  )
  .option<{ json: boolean }>("--json", "output json")
  .option<{ dry: boolean }>(
    "--dry",
    "leave the filesystem untouched (network activity and file reads are still expected)",
  )
  .action((_params, _query, _tags) => {
    throw new Error(`commnad 'remove' is not implemented yet.`);
  })
  .stopEarly()
  // parse
  .parse(Deno.args);

//! Utils

function displayFileType(fileType: FileType) {
  switch (fileType.type) {
    case "file":
      return fileType.path;
    case "link":
      return `${fileType.from} -> ${fileType.to}`;
  }
}

function displayFileDiff(linkDiff: FileDiff) {
  return [
    linkDiff.created.map(displayFileType).map((str) => `+ ${str}`),
    linkDiff.removed.map(displayFileType).map((str) => `- ${str}`),
  ].flat().join("\n");
}
