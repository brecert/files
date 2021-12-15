import * as path from "https://deno.land/std@0.114.0/path/mod.ts";
import { deepMerge } from "https://deno.land/std@0.114.0/collections/mod.ts";

import {
  Command,
  ITypeInfo,
  Type,
} from "https://deno.land/x/cliffy@v0.20.1/command/mod.ts";

import { Config } from "./formats/config.ts";
import { Lockfile } from "./formats/lockfile.ts";
import { writeLinks } from "./formats/linkfile.ts";
import { FileDiff, FileType } from "./formats/utils.ts";

import { parseSearch } from "./search.ts";

enum TagMode {
  Add = "add",
  Remove = "remove",
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

async function queryEnv(variable: string) {
  const res = await Deno.permissions.query({
    name: "env",
    variable: variable,
  });

  if (res.state === "denied") {
    console.debug(`Unabled to read '${variable}' from env`);
  }
}

await queryEnv("IMAGES_CONFIG_FILE");

const canWrite = await Deno.permissions.query({ name: "write" })
  .then((res) => res.state === "granted");

type Params = { configFile?: string; dry: boolean };
async function getConfig(params: Params) {
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

  let lockfile: Lockfile;
  try {
    lockfile = await Deno.readTextFile(lockfilePath)
      .then(JSON.parse)
      .then((json) => new Lockfile(config, json));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      // todo: clarify
      console.error(`${err.message}, using empty lockfile instead`);
      lockfile = Lockfile.default();
    } else {
      throw err;
    }
  }

  return { config, lockfile, configPath, outputPath, lockfilePath, isDry };
}

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
    "add <uri:uri> <tags...:tag>",
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
    const { config, lockfile, configPath, outputPath, isDry } = await getConfig(
      params,
    );

    const res = await config.edit((prev) =>
      deepMerge(prev, {
        files: {
          // todo: clean this mess
          [Date.now()]: {
            source: `${uri}`,
            tags: tags.map((tag) =>
              tag.value != null
                ? ({ [tag.path.join(".")]: tag.value })
                : tag.path.join(".")
            ),
          },
        },
      }), { dry: isDry, at: outputPath, lockfile });

    const diff = res.diff();

    if (params.json) {
      console.log(JSON.stringify(diff));
    } else {
      const output = formatFileDiff(diff);
      if (output.length > 0) {
        console.log(output);
      }
    }

    if (!isDry) {
      await Promise.all(
        writeLinks(diff, outputPath),
      );

      await Deno.writeTextFile(configPath, JSON.stringify(res.config, null, 2));
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
  // test
  .command<[string[]]>(
    "search <search...:string>",
    "search for specific files with tags.",
  )
  .action(async (params, search) => {
    const { config } = await getConfig({ ...params, dry: true });

    const fixed = fixSearchInput(search).join(" ");
    const parsed = parseSearch(fixed);
    // console.log(parsed, config);
    console.log(
      config.search(parsed),
    );
  })
  .stopEarly()
  // parse
  .parse(Deno.args);

//! Utils
function fixSearchInput(args: string[]) {
  return args.map((arg) => {
    const idx = arg.indexOf(":");
    if (idx >= 0) {
      const value = arg.slice(idx + 1);
      if (/\s/.test(value)) {
        return `${arg.slice(0, idx)}:"${value}"`;
      }
    }
    return arg;
  });
}

function formatFileType(fileType: FileType) {
  switch (fileType.type) {
    case "file":
      return fileType.path;
    case "link":
      return `${fileType.from} -> ${fileType.to}`;
  }
}

function formatFileDiff(linkDiff: FileDiff) {
  return [
    linkDiff.created.map(formatFileType).map((str) => `+ ${str}`),
    linkDiff.removed.map(formatFileType).map((str) => `- ${str}`),
  ].flat().join("\n");
}
