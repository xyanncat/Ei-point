"""URL security validation utilities (§5, OWASP SSRF protection)."""
from __future__ import annotations

import ipaddress
import socket
import urllib.parse


def is_safe_url(url_str: str) -> bool:
    """Validate query/stream URL against SSRF attacks (private networks, link-local, cloud metadata, DNS rebinding)."""
    try:
        parsed = urllib.parse.urlparse(url_str)
        if parsed.scheme not in ("http", "https"):
            return False
        host = parsed.hostname
        if not host:
            return False
        host_lower = host.lower()
        if host_lower in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False
        if host_lower.endswith((".internal", ".local", ".corp")) or host_lower.startswith("169.254."):
            return False
        # Resolve all IPs for host to prevent DNS rebinding
        try:
            addr_info = socket.getaddrinfo(host, None)
            for entry in addr_info:
                ip_str = entry[4][0]
                ip = ipaddress.ip_address(ip_str)
                if not ip.is_global:
                    return False
        except Exception:
            return False
        return True
    except Exception:
        return False
