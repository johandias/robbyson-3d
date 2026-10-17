"""Servidor local do Robbyson com proxy seguro para tokens efêmeros da Realtime API."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
HOST = os.getenv("ROBBYSON_HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
MAX_BODY_SIZE = 32_768

ALLOWED_MODELS = {
    "gpt-realtime-2.1",
    "gpt-realtime-2.1-mini",
    "gpt-realtime-2",
    "gpt-realtime-1.5",
}
ALLOWED_VOICES = {
    "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
}

ROBBYSON_INSTRUCTIONS = """
# Identidade
Você é Robbyson, o assistente online da AeC. Você conversa com colaboradores em português do Brasil de forma humana, tranquila, acolhedora e confiante.

# Papel
- Tire dúvidas gerais e ajude o colaborador a organizar ideias e próximos passos.
- Atue como coach de performance: faça perguntas úteis, reconheça avanços e proponha ações práticas.
- Dê feedback construtivo baseado no contexto fornecido. Estruture feedback em observação, impacto e próximo passo, sem soar mecânico.
- Quando faltarem informações, faça uma pergunta curta por vez. Não invente políticas, indicadores, resultados ou dados internos da AeC.
- Não afirme ter acesso a sistemas, histórico, metas ou informações pessoais que não tenham sido compartilhadas na conversa.

# Voz e comportamento
- Fale com calor humano, serenidade e segurança. Use ritmo natural, pausas leves e dicção clara.
- Seja objetivo por padrão: responda em 2 a 4 frases, aprofundando quando solicitado.
- Evite jargão, sermões, elogios exagerados e tom infantilizado.
- Em feedbacks difíceis, preserve dignidade, seja específico e termine com um caminho viável de melhoria.
- Se o usuário interromper, pare e escute. Nunca discuta com o colaborador.

# Limites
- Para temas médicos, jurídicos, financeiros, de segurança ou de RH com alto impacto, deixe claro o limite da orientação e indique o canal profissional apropriado.
- Proteja privacidade: não peça senhas, credenciais ou dados pessoais desnecessários.
""".strip()


def load_dotenv() -> None:
    """Carrega um .env local simples sem sobrescrever variáveis já definidas."""
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


class RobbysonHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request: Any, client_address: Any) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class RobbysonHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    public_paths = {"/", "/index.html", "/styles.css", "/app.js", "/T-Pose.fbx"}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/realtime/token":
            self.send_json(404, {"error": "Endpoint não encontrado."})
            return
        self.create_realtime_token()

    def do_GET(self) -> None:  # noqa: N802
        if not self.is_public_path():
            self.send_error(404, "File not found")
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if not self.is_public_path():
            self.send_error(404, "File not found")
            return
        super().do_HEAD()

    def is_public_path(self) -> bool:
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        return path in self.public_paths

    def create_realtime_token(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Content-Length inválido."})
            return
        if length <= 0 or length > MAX_BODY_SIZE:
            self.send_json(400, {"error": "Corpo da requisição inválido."})
            return

        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "JSON inválido."})
            return

        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            self.send_json(503, {"error": "Configure OPENAI_API_KEY no servidor antes de iniciar a conversa."})
            return

        model = str(payload.get("model", "")).strip()
        voice = str(payload.get("voice", "")).strip()
        if model not in ALLOWED_MODELS:
            self.send_json(400, {"error": "Modelo não permitido."})
            return
        if voice not in ALLOWED_VOICES:
            self.send_json(400, {"error": "Voz não permitida."})
            return

        session_config = {
            "type": "realtime",
            "model": model,
            "instructions": ROBBYSON_INSTRUCTIONS,
            "output_modalities": ["audio"],
            "max_output_tokens": 900,
            "audio": {
                "input": {
                    "noise_reduction": {"type": "far_field"},
                    "transcription": {
                        "model": "gpt-transcribe",
                        "language": "pt",
                        "prompt": "Conversa de trabalho em português do Brasil sobre AeC, performance, feedback e desenvolvimento profissional.",
                    },
                    "turn_detection": {
                        "type": "semantic_vad",
                        "eagerness": "auto",
                        "create_response": True,
                        "interrupt_response": True,
                    },
                },
                "output": {"voice": voice, "speed": 1.0},
            },
        }
        if model != "gpt-realtime-1.5":
            session_config["reasoning"] = {"effort": "low"}
        session = {"session": session_config}

        request = urllib.request.Request(
            "https://api.openai.com/v1/realtime/client_secrets",
            data=json.dumps(session).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "OpenAI-Safety-Identifier": self.safety_identifier(),
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                response_data = json.loads(response.read().decode("utf-8"))
            self.send_json(200, response_data, no_store=True)
        except urllib.error.HTTPError as error:
            detail = self.openai_error_message(error)
            self.log_error("OpenAI retornou HTTP %s: %s", error.code, detail)
            status = error.code if 400 <= error.code < 500 else 502
            self.send_json(status, {"error": detail}, no_store=True)
        except (urllib.error.URLError, TimeoutError):
            self.send_json(502, {"error": "Não foi possível alcançar a OpenAI."}, no_store=True)

    def safety_identifier(self) -> str:
        client_ip = self.client_address[0]
        return hashlib.sha256(f"robbyson-local:{client_ip}".encode()).hexdigest()

    @staticmethod
    def openai_error_message(error: urllib.error.HTTPError) -> str:
        try:
            body = json.loads(error.read().decode("utf-8"))
            message = body.get("error", {}).get("message")
            if message:
                return f"OpenAI: {message}"
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
        return "A OpenAI não conseguiu criar a sessão de voz. Verifique chave, modelo e limites da conta."

    def send_json(self, status: int, payload: dict[str, Any], *, no_store: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if no_store:
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self) -> None:
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()


def main() -> None:
    load_dotenv()
    server = RobbysonHTTPServer((HOST, PORT), RobbysonHandler)
    print(f"Robbyson disponível em http://localhost:{PORT}")
    if not os.getenv("OPENAI_API_KEY"):
        print("Aviso: OPENAI_API_KEY ainda não está configurada; o visualizador funcionará sem a conversa por voz.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
