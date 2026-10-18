"""Exercise actual service persistence functions with an injected DB, without Discord/network."""
import ast
import asyncio
import json
import os
import threading
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch
sys.path.insert(0,str(Path(__file__).parents[1] / "src"))
from queue_state import QueueState, Track


def service_functions():
    path = Path(os.environ.get("MUSIC_SOURCE_PATH", str(Path(__file__).parents[1] / "src/main.py")))
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = {"get_or_create_queue", "cmd_pause", "cmd_resume", "extract_tracks"}
    tree.body = [node for node in tree.body if isinstance(node, (ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in names]
    for node in tree.body:
        node.decorator_list = []
    namespace = dict(asyncio=asyncio,sys=sys,yt_dlp=True,metadata_semaphore=asyncio.Semaphore(2),is_safe_url=lambda query:True, discord=MagicMock(), check_dj_permission=AsyncMock(return_value=True),respond=AsyncMock(),json=json, threading=threading, time=time, QueueState=QueueState, db_lock=threading.Lock(),
                     db_conn=MagicMock(), db_ready=True, guild_queues={}, track_started_at={}, refresh_music_panel=AsyncMock(), log=MagicMock())
    exec(compile(tree, str(path), "exec"), namespace)
    return namespace


class AsyncRuntimeBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def test_pause_freezes_offset_and_resume_restarts_clock(self):
        runtime = service_functions()
        interaction = MagicMock()
        interaction.guild_id = "guild"
        runtime["guild_queues"]["guild"] = QueueState(tracks=[Track("one","one",100000)])
        runtime["track_started_at"]["guild"] = 100
        with patch.object(time,"time",return_value=145):
            await runtime["cmd_pause"](interaction)
        with patch.object(time,"time",return_value=900):
            self.assertEqual(runtime["guild_queues"]["guild"].position_ms,45000)
            await runtime["cmd_resume"](interaction)
            self.assertEqual(runtime["track_started_at"]["guild"],855)

    async def test_metadata_timeout_kills_worker_before_releasing_slot(self):
        runtime = service_functions()
        process = MagicMock()
        process.returncode = None
        process.communicate = AsyncMock()
        process.wait = AsyncMock()
        async def timeout(awaitable, timeout):
            awaitable.close()
            raise asyncio.TimeoutError()
        with patch.object(asyncio,"create_subprocess_exec",AsyncMock(return_value=process)), patch.object(asyncio,"wait_for",timeout):
            self.assertEqual(await runtime["extract_tracks"]("song"),[])
        process.kill.assert_called_once()
        process.wait.assert_awaited_once()
