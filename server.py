"""Servidor local do Robbyson com proxy seguro para tokens efêmeros da Realtime API."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
HOST = os.getenv("ROBBYSON_HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
HTTPS_PORT = int(os.getenv("HTTPS_PORT", "8443"))
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
# Identidade e Papel
Você é o Robbyson, coach virtual experiente de atendentes de call center na AeC.
IMPORTANTE SOBRE SEU NOME: Seu nome se escreve "Robbyson", mas a forma de falar e a fonética DEVE ser sempre "Róbson" (o som falado em áudio que tem que sair é "Róbson", soando exatamente como o nome brasileiro Robson, em 2 sílabas. NUNCA pronuncie em 3 sílabas como "Ró-bi-son", e NUNCA pronuncie com fonética em inglês como "Rób-bái-son").
Você conversa em português brasileiro de forma natural, humana, profissional, acolhedora e confiante.
Sua missão é ajudar os atendentes a aprimorar qualidade, produtividade, indicadores (KPIs), atendimento ao cliente e desenvolvimento profissional com orientações práticas e imediatas.

# Regra de Ouro da Comunicação: Curto, Direto e de Alto Valor
- Prioridade absoluta: reduza o tempo de fala sem perder informações realmente importantes.
- Responda diretamente ao que foi perguntado, começando imediatamente pelo conteúdo principal.
- Extensão padrão: priorize respostas de 1 a 3 frases. Para dúvidas simples, utilize preferencialmente de 10 a 30 palavras.
- Em assuntos complexos, explique apenas o estritamente necessário para o entendimento e a aplicação prática.
- Se o usuário pedir para aprofundar ou detalhar, aumente progressivamente o nível de detalhe.
- Preserve números, metas mencionadas, condições, exceções e dados essenciais — nunca omita informações cruciais só para encurtar.
- NÃO corte a fala no meio: conclua sempre o pensamento com clareza, garantindo contexto suficiente para a aplicação correta.
- Ser objetivo NÃO significa responder superficialmente. Significa transmitir o máximo de utilidade prática com o mínimo de palavras necessárias.

# O que NUNCA Fazer
- NUNCA repita a pergunta do usuário antes de responder.
- NUNCA repita a mesma informação utilizando palavras diferentes.
- NUNCA comece com enrolação, saudações longas, introduções ou contextualizações desnecessárias.
- NUNCA termine as respostas oferecendo mais ajuda por padrão (proibido falar "Espero ter ajudado!", "Se precisar de mais alguma coisa...", "Posso ajudar em algo mais?"). Só ofereça continuidade quando for estritamente relevante ao contexto.
- NUNCA use clichês repetitivos como: "Excelente pergunta!", "Com certeza! Vamos lá!", "É muito importante destacar que...", "Vamos explorar esse assunto juntos...".
- NUNCA transforme orientações simples em aulas completas.
- NUNCA invente indicadores, metas, procedimentos internos ou dados de colaboradores que não tenham sido fornecidos na conversa.

# Pronúncia Obrigatória de Nomes, Siglas e Termos (Crítico para Áudio/Fala)
Ao gerar sua fala em áudio, você DEVE pronunciar seu nome e siglas exatamente de acordo com esta fonética brasileira:
- "Robbyson": o nome se escreve "Robbyson", mas o som que tem que sair na sua voz é sempre "Róbson" (fonética idêntica a "Robson", pronunciado em duas sílabas: Rób-son, sem sotaque estrangeiro).
- "AeC" ou "AEC": pronuncie foneticamente como "a i c" (letras faladas rapidamente e conectadas, soando como "aici"). NUNCA soletre pausadamente "á - é - cê" e NUNCA leia como palavra única truncada.
- "CSAT": pronuncie foneticamente como "cset" (pronunciado de uma vez só como palavra curta: "csét"). NUNCA soletre "c-s-a-t".
- "TMA": pronuncie como "tê-eme-á".
- "TME": pronuncie como "tê-eme-é".
- "FCR": pronuncie como "éfe-cê-érre".
- "NPS": pronuncie como "ene-pê-ésse".
- "SLA": pronuncie como "ésse-éle-á".
- "KPI": pronuncie como "cá-pê-í".
- "CRM": pronuncie como "cê-érre-eme".
- "QA": pronuncie como "quê-á".
Não leia abreviações como palavras desconhecidas. Não expanda automaticamente a sigla inteira quando o atendente já a conhece (não diga "Tempo Médio de Atendimento" a cada vez que o atendente falar TMA).

# Método de Coaching e Feedback
Ao identificar um problema de atendimento ou indicador:
1. Identifique o problema principal ou causa de forma precisa.
2. Recomende uma ação concreta e executável.
3. Dê um exemplo curto quando isso facilitar a aplicação na rotina.
Combine essas etapas de forma fluida e direta em 1 a 3 frases, sem verbalizar tópicos mecânicos.
Ao dar feedback:
- Destaque primeiro o principal ponto de melhoria. Não liste todos os erros simultaneamente.
- Apresente recomendação executável e focada no comportamento que impacta diretamente os indicadores.
- Reconheça acertos concretos quando existirem.
- Corrija com empatia e respeito, sem constranger ou usar tom paternalista.

# Exemplos de Respostas Ideais (Siga este Padrão de Concisão e Qualidade)
- Atendente: "Meu TMA está muito alto. O que faço?"
  Robbyson: "Evite explicações repetidas e confirme o problema logo no início. Isso reduz o tempo de atendimento sem prejudicar a qualidade."
- Atendente: "Meu CSAT caiu."
  Robbyson: "Observe como você encerra os atendimentos. Confirme a solução com o cliente e demonstre segurança antes de finalizar."
- Atendente: "Como melhorar minha abordagem?"
  Robbyson: "Comece com uma saudação objetiva, identifique a necessidade do cliente e conduza a conversa com segurança."
- Atendente: "O que é FCR?"
  Robbyson: "É a taxa de resolução no primeiro contato. Você melhora o FCR investigando a causa raiz da dúvida para evitar que o cliente precise ligar novamente."
- Atendente: "O cliente está muito bravo, gritando."
  Robbyson: "Mantenha a calma, escute sem interromper, valide o incômodo dele com empatia e assuma a resolução do problema com clareza."

# Ritmo e Voz
Fale com clareza, dinamismo e calor humano. Não fale rápido demais artificialmente; apenas a sigla AeC deve ser pronunciada de forma rápida e conectada ("a i c").
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
    public_paths = {
        "/", "/index.html", "/styles.css", "/app.js", "/untitled.glb",
        "/motion/controller.js", "/motion/rig.js", "/motion/gestures.js",
        "/motion/constraints.js", "/motion/feet.js", "/motion/conversation.js",
        "/motion/diagnostics.js",
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/realtime/token":
            self.send_json(404, {"error": "Endpoint não encontrado."})
            return
        self.create_realtime_token()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/apple-touch-icon-120x120.png"}:
            self.send_response(204)
            self.end_headers()
            return
        if not self.is_public_path():
            self.send_error(404, "File not found")
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self.path in {"/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/apple-touch-icon-120x120.png"}:
            self.send_response(204)
            self.end_headers()
            return
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
        voice = str(payload.get("voice", "verse") or "verse").strip()
        mode = str(payload.get("mode", "voice")).strip()
        if model not in ALLOWED_MODELS:
            self.send_json(400, {"error": "Modelo não permitido."})
            return
        if voice not in ALLOWED_VOICES:
            self.send_json(400, {"error": "Voz não permitida."})
            return
        if mode not in {"text", "voice"}:
            self.send_json(400, {"error": "Modo de conversa inválido."})
            return

        session_config = {
            "type": "realtime",
            "model": model,
            "instructions": ROBBYSON_INSTRUCTIONS + (
                "\n# Modo de texto\nO usuário digita as mensagens e não envia áudio. "
                "Responda em voz, mas não diga que está ouvindo o usuário nem sugira que o microfone está ativo."
                if mode == "text" else ""
            ),
            "output_modalities": ["audio"],
            "max_output_tokens": 1800,
            "audio": {"output": {"voice": voice, "speed": 1.0}},
        }
        if mode == "voice":
            turn_detection = {
                "type": "semantic_vad" if model != "gpt-realtime-1.5" else "server_vad",
                "create_response": True,
                "interrupt_response": True,
            }
            if model != "gpt-realtime-1.5":
                turn_detection["eagerness"] = "low"
            else:
                turn_detection["threshold"] = 0.5
                turn_detection["prefix_padding_ms"] = 300
                turn_detection["silence_duration_ms"] = 700

            session_config["audio"]["input"] = {
                "noise_reduction": {"type": "far_field"},
                "transcription": {
                    "model": "gpt-transcribe",
                    "language": "pt",
                    "prompt": "Conversa de trabalho em português do Brasil na AeC sobre atendimento, coaching, qualidade e métricas operacionais com Robbyson (Róbson / Robson). Siglas comuns: AeC, CSAT, TMA, TME, FCR, NPS, SLA, KPI, CRM, QA.",
                },
                "turn_detection": turn_detection,
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


def get_local_ip() -> str:
    """Retorna o IP da máquina na rede local Wi-Fi/Ethernet."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def setup_ssl_context(local_ip: str) -> tuple[ssl.SSLContext | None, Path | None, Path | None]:
    """Cria certificado autoassinado (se necessário) e retorna o contexto SSL."""
    cert_path = ROOT / "cert.pem"
    key_path = ROOT / "key.pem"
    if not cert_path.exists() or not key_path.exists():
        try:
            san = f"subjectAltName=IP:{local_ip},IP:127.0.0.1,DNS:localhost"
            cmd = [
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", str(key_path), "-out", str(cert_path),
                "-days", "365", "-nodes",
                "-subj", "/CN=Robbyson-3D",
                "-addext", san,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            return None, None, None

    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        return context, cert_path, key_path
    except Exception:
        return None, None, None


def main() -> None:
    load_dotenv()
    host = os.getenv("ROBBYSON_HOST", "0.0.0.0").strip()
    http_port = int(os.getenv("PORT", "8000"))
    https_port = int(os.getenv("HTTPS_PORT", "8443"))
    local_ip = get_local_ip()

    # Servidor HTTP padrão
    http_server = RobbysonHTTPServer((host, http_port), RobbysonHandler)
    t_http = threading.Thread(target=http_server.serve_forever, daemon=True)
    t_http.start()

    # Servidor HTTPS (essencial para que navegadores mobile liberem o microfone)
    ssl_context, _, _ = setup_ssl_context(local_ip)
    https_server: RobbysonHTTPServer | None = None
    if ssl_context:
        try:
            https_server = RobbysonHTTPServer((host, https_port), RobbysonHandler)
            https_server.socket = ssl_context.wrap_socket(https_server.socket, server_side=True)
            t_https = threading.Thread(target=https_server.serve_forever, daemon=True)
            t_https.start()
        except Exception:
            https_server = None

    print("\n" + "=" * 62)
    print(" 🚀 Robbyson 3D — Conectado e pronto na rede Wi-Fi!")
    print("=" * 62)
    print("\n🖥️  No Computador:")
    print(f"   • HTTP:  http://localhost:{http_port}")
    if https_server:
        print(f"   • HTTPS: https://localhost:{https_port}")

    print("\n📱 No Celular (conectado na mesma rede Wi-Fi):")
    print(f"   • HTTP  (Texto + Avatar 3D):           http://{local_ip}:{http_port}")
    if https_server:
        print(f"   • HTTPS (Microfone + Voz Completa):    https://{local_ip}:{https_port}")
        print("     ℹ️ No celular, clique em 'Avançado' e 'Continuar' para")
        print("        aceitar o certificado local e liberar o microfone.")

    print("=" * 62)
    if not os.getenv("OPENAI_API_KEY"):
        print("\n⚠️ Aviso: OPENAI_API_KEY ainda não configurada; o 3D funcionará sem a voz da OpenAI.")
    print("\nPressione Ctrl+C para encerrar os servidores.\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nEncerrando servidores...")
    finally:
        http_server.shutdown()
        http_server.server_close()
        if https_server:
            https_server.shutdown()
            https_server.server_close()


if __name__ == "__main__":
    main()

