import { ArrayDiff, diffArray } from "../utils.ts";

import { Tag } from "./common.ts";
import { ConfigTag } from "./config.ts";
import { ILinkfile } from "./linkfile.ts";

export function parseConfigTag(tag: ConfigTag): Tag[] {
  if (typeof tag === "object") {
    return Object.entries(tag).map((tag) => ({ path: tag[0], value: tag[1] }));
  }

  const [path, value] = tag.split(/:/);
  return [{ path: path, value: value ?? null }];
}

//! Misc Utils (effects?)

export function resolveURIString(uri: string) {
  console.error('"resolveURIString" is unimplemented!');
  return uri;
}

//! File diffing

export type FileDiffParams = {
  prev: Readonly<ILinkfile>;
};

export type FileType =
  | { type: "file"; path: string }
  | { type: "link"; from: string; to: string };

export type FileDiff = ArrayDiff<FileType>;

export function generateFileDiff(
  linkfile: Readonly<ILinkfile>,
  { prev }: FileDiffParams,
): FileDiff {
  let linkDiff: FileDiff = {
    created: [],
    removed: [],
  };

  const diffedKeys = diffArray(
    Object.keys(prev.links),
    Object.keys(linkfile.links),
  );

  const intoFile = (key: string): FileType => ({
    type: "file",
    path: key,
  });

  const intoLinks = (key: string, links: string[]): FileType[] =>
    links.map((link) => ({
      type: "link",
      from: key,
      to: link,
    }));

  linkDiff.created = linkDiff.created.concat(diffedKeys.created.map(intoFile));
  linkDiff.removed = linkDiff.removed
    .concat(diffedKeys.removed.map(intoFile))
    .concat(
      diffedKeys.removed.flatMap((key) => intoLinks(key, prev.links[key])),
    );

  linkDiff = Object.keys(linkfile.links)
    .map((key) => {
      return [
        key,
        diffArray(prev.links[key] ?? [], linkfile.links[key]),
      ] as const;
    })
    .reduce((prev, [key, diff]) => {
      return {
        created: prev.created.concat(intoLinks(key, diff.created)),
        removed: prev.removed.concat(intoLinks(key, diff.removed)),
      };
    }, linkDiff);

  return linkDiff;
}
