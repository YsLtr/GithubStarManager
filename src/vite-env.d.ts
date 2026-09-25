/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />

/** vite.config.ts 的 define 注入：产物/脚本名 slug（构建期常量，改名只改 vite.config.ts 一处） */
declare const __SCRIPT_SLUG__: string;
