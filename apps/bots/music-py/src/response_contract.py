"""Robin response contract: every interaction reply goes through the embed helper.

The approved Robin surface is a bounded set of registered roots. Each success,
error and empty path must reply through ``respond``/``make_ei_embed`` so the
configured per-bot embed image is applied instead of a bare text message.

This module stays dependency-free (no discord.py) so tests can exercise the
contract without the runtime. ``respond`` is aliased through
:func:`embed_reply_helper`, and every enforced call site is marked by calling
that alias. ``tests/test_response_embeds.py`` parses ``main.py`` and asserts
that:
  * the ``respond`` definition is wrapped by ``embed_reply_helper``;
  * no interaction reply/delivery call is reachable inside a registered
    command without passing through the marked helper.

PRODUCT: "Route Robin success/error/empty paths through configured embed/image
helper; cover every registered root." - EI_POINT_COMPLETION_BUILD_PLAN.md §8C.
"""


def embed_reply_helper(respond_callable):
    """Return the embed reply helper used by every Robin command response.

    ``main.py`` keeps this call at module level:
    ``respond = embed_reply_helper(respond)``. The contract tests use the
    marker to locate the helper definition in the module AST.
    """
    return respond_callable
