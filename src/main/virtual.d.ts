declare module "virtual:roblox-session-page" {
  const script: string;
  export default script;
}

/** electron-vite copies the file into the build and gives back its path. */
declare module "*?asset" {
  const filePath: string;
  export default filePath;
}
