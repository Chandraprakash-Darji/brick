export async function hello(name: string) {
  "use workflow";
  return await greet(name);
}

async function greet(name: string) {
  "use step";
  return `hi ${name}`;
}
