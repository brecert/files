import { ensureSymlink } from "https://deno.land/std@0.114.0/fs/mod.ts";
import { deepMerge } from "https://deno.land/std@0.114.0/collections/mod.ts";
import * as path from "https://deno.land/std@0.114.0/path/mod.ts";

import { FileDiff } from "./utils.ts";
import { Lockfile } from "./lockfile.ts";

export function genLinkPaths(lockfile: Lockfile, id: string) {
  const lock = lockfile.file_locks[id];
  return lock.tags.map((tag) => {
    return path.join(tag.path, tag.value ?? "", id);
  });
}

export interface ILinkfile {
  links: Record<string, string[]>;
}

export class Linkfile implements ILinkfile {
  #lockfile: Lockfile;
  links: ILinkfile["links"] = {};

  static default() {
    return new this(Lockfile.default());
  }

  static from(lockfile: Lockfile) {
    return new this(lockfile).generate();
  }

  constructor(lockfile: Lockfile, linkfile?: ILinkfile) {
    this.#lockfile = lockfile;
    if (linkfile) {
      this.links = linkfile.links;
    }
  }

  generate() {
    const links = Object.keys(this.#lockfile.file_locks)
      .map((id) =>
        [
          path.join(".hash", this.#lockfile.file_locks[id].hash),
          genLinkPaths(this.#lockfile, id),
        ] as const
      )
      .reduce((prev, [from, links]) => deepMerge(prev, { [from]: links }), {});

    const linkfile: ILinkfile = {
      links: links,
    };

    return new Linkfile(this.#lockfile, linkfile);
  }
}

export function writeLinks(diff: FileDiff, at = "") {
  const promises = [];

  for (const link of diff.created) {
    if (link.type === "link") {
      promises.push(
        ensureSymlink(path.resolve(at, link.from), path.resolve(at, link.to)),
      );
    }
  }

  for (const link of diff.removed) {
    const filePath = link.type === "link" ? link.to : link.path;
    promises.push(Deno.remove(path.resolve(at, filePath)));
  }

  return promises;
}
