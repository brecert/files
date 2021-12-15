import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.115.1/testing/asserts.ts";
import { isMatch, match, parseSearch, TagType } from "./search.ts";

Deno.test("parseSearch smoketest", () => {
  const search =
    `+animal [~dog ~cat] [+fur.black +fur.white] -name:fido ~name:"bree bree"`;

  assertEquals(parseSearch(search), [
    { path: "animal", value: undefined, type: TagType.Require },
    {
      exprs: [
        { path: "dog", value: undefined, type: TagType.Include },
        { path: "cat", value: undefined, type: TagType.Include },
      ],
    },
    {
      exprs: [
        { path: "fur.black", value: undefined, type: TagType.Require },
        { path: "fur.white", value: undefined, type: TagType.Require },
      ],
    },
    { path: "name", value: "fido", type: TagType.Exclude },
    { path: "name", value: "bree bree", type: TagType.Include },
  ]);
});

Deno.test("parseSearch errors when no valid tags", () => {
  const search = `animal dog`;
  assertThrows(() => parseSearch(search));
});

Deno.test("match", () => {
  let tags = [];
  const search = parseSearch(`+animal [+cat ~wolf] -dog`);

  tags = [
    { path: "animal", value: "sheep" },
    { path: "cat", value: null },
  ];
  assertEquals(match(tags, search), {
    require: true,
    include: undefined,
    exclude: true,
    groups: [{
      require: true,
      include: false,
      exclude: undefined,
      groups: [],
    }],
  });

  tags = [
    { path: "animal", value: "sheep" },
  ];
  assertEquals(match(tags, search), {
    require: true,
    include: undefined,
    exclude: true,
    groups: [{
      require: false,
      include: false,
      exclude: undefined,
      groups: [],
    }],
  });
});

Deno.test("isMatch", () => {
  let tags = [];
  const search = parseSearch(`+animal [+cat ~wolf] -dog`);

  tags = [
    { path: "animal", value: "sheep" },
    { path: "cat", value: null },
  ];
  assertEquals(isMatch(match(tags, search)), true);

  tags = [
    { path: "animal", value: "sheep" },
    { path: "wolf", value: null },
  ];
  assertEquals(isMatch(match(tags, search)), true);

  tags = [
    { path: "animal", value: "sheep" },
    { path: "wolf", value: null },
    { path: "dog", value: null },
  ];
  assertEquals(isMatch(match(tags, search)), false);

  tags = [
    { path: "wolf", value: null },
    { path: "dog", value: null },
  ];
  assertEquals(isMatch(match(tags, search)), false);
});
