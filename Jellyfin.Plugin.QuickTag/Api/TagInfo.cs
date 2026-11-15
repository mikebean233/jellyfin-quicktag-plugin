namespace Jellyfin.Plugin.QuickTag.Api;

/// <summary>
/// A tag and how many titles carry it.
/// </summary>
/// <param name="Name">The tag.</param>
/// <param name="Count">Number of top-level titles (movies, series, collections, videos) with the tag.</param>
public record TagInfo(string Name, int Count);
