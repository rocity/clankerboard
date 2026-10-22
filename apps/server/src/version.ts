import pkg from "../package.json" with { type: "json" };

/** The app's version, from the server package. The bundle inlines it at build time. */
export const appVersion: string = pkg.version;
