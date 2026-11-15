using System.Collections.Generic;

namespace Jellyfin.Plugin.QuickTag.Api;

/// <summary>
/// Result of an <see cref="ApplyTagRequest"/>.
/// </summary>
/// <param name="Added">Items that now have the tag.</param>
/// <param name="Removed">Items that no longer have the tag.</param>
/// <param name="Failed">Items that were not found or could not be saved.</param>
public record ApplyTagResult(IReadOnlyList<string> Added, IReadOnlyList<string> Removed, IReadOnlyList<string> Failed);
