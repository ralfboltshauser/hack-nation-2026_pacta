import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { compileUseCaseConfig } from "./compiler";

const root = resolve(import.meta.dirname, "../../../config/use-cases");
const cases = await readdir(root, { withFileTypes: true });
let count = 0;

for (const useCase of cases.filter((entry) => entry.isDirectory())) {
  const directory = resolve(root, useCase.name);
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".json"),
  );
  for (const file of files) {
    const document = JSON.parse(
      await readFile(resolve(directory, file), "utf8"),
    ) as unknown;
    const compiled = compileUseCaseConfig(document);
    process.stdout.write(
      `${compiled.document.key}@${compiled.document.version} ${compiled.contentSha256.slice(0, 12)}\n`,
    );
    count += 1;
  }
}

if (count < 2)
  throw new Error(
    "At least two structurally different use-case configurations are required",
  );
