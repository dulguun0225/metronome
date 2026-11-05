// Code of a module imported with the "?worklet" suffix (see the worklet plugin in vite.config.ts).
declare module "*?worklet" {
  const code: string;
  export default code;
}
