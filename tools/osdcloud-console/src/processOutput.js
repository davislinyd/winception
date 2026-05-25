import { StringDecoder } from 'node:string_decoder';

export const powershellUtf8Prelude = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false);';

export function preparePowerShellArgs(args) {
  const prepared = [...args];
  const commandIndex = prepared.findIndex((arg) => ['-command', '-c'].includes(String(arg).toLowerCase()));
  if (commandIndex >= 0 && commandIndex + 1 < prepared.length) {
    const command = String(prepared[commandIndex + 1]);
    if (!command.includes('[Console]::OutputEncoding')) {
      prepared[commandIndex + 1] = `${powershellUtf8Prelude}\n${command}`;
    }
  }
  return prepared;
}

export function createUtf8Collector(onText) {
  const decoder = new StringDecoder('utf8');
  let text = '';
  return {
    write(chunk) {
      const decoded = decoder.write(chunk);
      if (decoded) {
        text += decoded;
        onText?.(decoded);
      }
      return decoded;
    },
    end() {
      const decoded = decoder.end();
      if (decoded) {
        text += decoded;
        onText?.(decoded);
      }
      return decoded;
    },
    get text() {
      return text;
    },
  };
}

export function collectProcessOutput(child, options = {}) {
  return new Promise((resolve, reject) => {
    const stdout = createUtf8Collector(options.onStdout);
    const stderr = createUtf8Collector(options.onStderr);

    child.stdout?.on('data', (chunk) => {
      stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      stdout.end();
      stderr.end();
      resolve({ stdout: stdout.text, stderr: stderr.text, code });
    });
  });
}
