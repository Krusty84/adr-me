/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { isAbsolute } from "node:path";

// Repository-relative code paths. Set these for each target repository.
const CODE_PATHS = [".github/scripts/", ".githooks/", "create-adr-md/scripts/", "create-adr-md/tests/", "create-update-architecture-md/scripts/", "create-update-architecture-md/tests/"];

export const codePathspecs = Array.isArray(CODE_PATHS) && CODE_PATHS.every(
  (path) => typeof path === "string" && path.trim().length > 0 &&
    !isAbsolute(path) && !path.split(/[\\/]/).includes(".."),
) ? CODE_PATHS.map((path) => `:(literal)${path}`) : null;

export function missingAdrCommits(commits, adrs) {
  const referenced = new Set(
    adrs.filter(({ errors }) => errors.length === 0).flatMap(({ links }) => links),
  );
  return commits.filter((sha) => !referenced.has(sha));
}
