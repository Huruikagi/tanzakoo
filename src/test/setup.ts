import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { setLanguage } from "@/lib/i18n";
beforeEach(() => setLanguage("ja"));
afterEach(cleanup);
