using System;
using System.Collections.Generic;
using System.Net.Mime;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.QuickTag.Api;

/// <summary>
/// QuickTag's API, used by its web client script.
/// </summary>
[ApiController]
[Route("QuickTag")]
public class QuickTagController : ControllerBase
{
    private readonly TagService _tagService;

    /// <summary>
    /// Initializes a new instance of the <see cref="QuickTagController"/> class.
    /// </summary>
    /// <param name="tagService">The tag service.</param>
    public QuickTagController(TagService tagService)
    {
        _tagService = tagService;
    }

    /// <summary>
    /// Serves the web client script that adds Tag mode.
    /// </summary>
    /// <returns>The script.</returns>
    [HttpGet("ClientScript")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult GetClientScript()
    {
        var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.QuickTag.Web.quicktag.js");
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(stream, "application/javascript; charset=utf-8");
    }

    /// <summary>
    /// Lists every tag on a title in the library.
    /// </summary>
    /// <returns>Tags and their title counts, most used first.</returns>
    [HttpGet("Tags")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<IReadOnlyList<TagInfo>> GetTags()
    {
        return Ok(_tagService.GetTags());
    }

    /// <summary>
    /// Lists the items that have a tag.
    /// </summary>
    /// <param name="tag">The tag.</param>
    /// <returns>Item ids.</returns>
    [HttpGet("Items")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<IReadOnlyList<string>> GetItemsWithTag([FromQuery] string tag)
    {
        var normalized = TagService.NormalizeTag(tag);
        if (normalized is null)
        {
            return BadRequest("Tag is empty or contains '|'.");
        }

        return Ok(_tagService.GetItemIdsWithTag(normalized));
    }

    /// <summary>
    /// Adds a tag to some items and removes it from others.
    /// </summary>
    /// <param name="request">The tag and the items.</param>
    /// <returns>What changed.</returns>
    [HttpPost("Apply")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ApplyTagResult>> Apply([FromBody] ApplyTagRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var normalized = TagService.NormalizeTag(request.Tag);
        if (normalized is null)
        {
            return BadRequest("Tag is empty or contains '|'.");
        }

        // Not tied to the request's cancellation: a closed tab mustn't leave a series half-tagged
        return Ok(await _tagService.ApplyAsync(normalized, request.Add, request.Remove, CancellationToken.None).ConfigureAwait(false));
    }
}
