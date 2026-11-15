using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.QuickTag.Api;

/// <summary>
/// Adds a tag to some items and removes it from others, in one call.
/// </summary>
public class ApplyTagRequest
{
    /// <summary>
    /// Gets or sets the tag.
    /// </summary>
    public string Tag { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the items to add the tag to.
    /// </summary>
    public IReadOnlyList<Guid> Add { get; set; } = [];

    /// <summary>
    /// Gets or sets the items to remove the tag from.
    /// </summary>
    public IReadOnlyList<Guid> Remove { get; set; } = [];
}
