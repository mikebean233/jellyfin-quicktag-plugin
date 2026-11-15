using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.QuickTag.Api;

/// <summary>
/// Reads and writes item tags, the way the server's own metadata editor does.
/// </summary>
public sealed class TagService : IDisposable
{
    /// <summary>
    /// Item kinds counted as titles in the tag list.
    /// </summary>
    private static readonly BaseItemKind[] _titleKinds =
    [
        BaseItemKind.Movie,
        BaseItemKind.Series,
        BaseItemKind.BoxSet,
        BaseItemKind.Video,
        BaseItemKind.MusicVideo,
    ];

    /// <summary>
    /// Item kinds whose cards can be tagged.
    /// </summary>
    private static readonly BaseItemKind[] _taggableKinds = [.. _titleKinds, BaseItemKind.Season, BaseItemKind.Episode];

    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<TagService> _logger;

    // One writer at a time: two quick clicks on the same series must not race on its children
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    /// <summary>
    /// Initializes a new instance of the <see cref="TagService"/> class.
    /// </summary>
    /// <param name="libraryManager">The library manager.</param>
    /// <param name="logger">The logger.</param>
    public TagService(ILibraryManager libraryManager, ILogger<TagService> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _writeLock.Dispose();
    }

    /// <summary>
    /// Cleans a tag the way the server stores it, or returns null if it can't be stored.
    /// </summary>
    /// <param name="tag">The tag as typed.</param>
    /// <returns>The trimmed tag, or null.</returns>
    public static string? NormalizeTag(string? tag)
    {
        var trimmed = tag?.Trim();

        // The database keeps an item's tags in one '|'-separated column
        return string.IsNullOrEmpty(trimmed) || trimmed.Contains('|', StringComparison.Ordinal) ? null : trimmed;
    }

    /// <summary>
    /// Lists every tag on a title in the library, most used first.
    /// </summary>
    /// <returns>The tags.</returns>
    public IReadOnlyList<TagInfo> GetTags()
    {
        var items = _libraryManager.GetItemList(new InternalItemsQuery
        {
            IncludeItemTypes = _titleKinds,
            Recursive = true,
        });

        return items
            .SelectMany(i => i.Tags.Distinct(StringComparer.OrdinalIgnoreCase))
            .GroupBy(t => t, StringComparer.OrdinalIgnoreCase)
            .Select(g => new TagInfo(g.First(), g.Count()))
            .OrderByDescending(t => t.Count)
            .ThenBy(t => t.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Lists the ids of every taggable item that has the tag.
    /// </summary>
    /// <param name="tag">The tag.</param>
    /// <returns>Item ids, in the client's format (32 hex digits, no dashes).</returns>
    public IReadOnlyList<string> GetItemIdsWithTag(string tag)
    {
        return _libraryManager.GetItemIds(new InternalItemsQuery
        {
            IncludeItemTypes = _taggableKinds,
            Recursive = true,
            Tags = [tag],
        }).Select(id => id.ToString("N")).ToList();
    }

    /// <summary>
    /// Adds the tag to some items and removes it from others.
    /// </summary>
    /// <param name="tag">The tag, already normalized.</param>
    /// <param name="add">Items to add it to.</param>
    /// <param name="remove">Items to remove it from.</param>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>What changed.</returns>
    public async Task<ApplyTagResult> ApplyAsync(string tag, IEnumerable<Guid> add, IEnumerable<Guid> remove, CancellationToken cancellationToken)
    {
        var added = new List<string>();
        var removed = new List<string>();
        var failed = new List<string>();

        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            foreach (var (id, isAdd) in add.Select(id => (id, true)).Concat(remove.Select(id => (id, false))))
            {
                var item = _libraryManager.GetItemById(id);
                if (item is null)
                {
                    failed.Add(id.ToString("N"));
                    continue;
                }

                try
                {
                    await SetTagAsync(item, tag, isAdd, cancellationToken).ConfigureAwait(false);
                    (isAdd ? added : removed).Add(id.ToString("N"));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "QuickTag: could not {Action} tag {Tag} on {Item}", isAdd ? "add" : "remove", tag, item.Name);
                    failed.Add(id.ToString("N"));
                }
            }
        }
        finally
        {
            _writeLock.Release();
        }

        return new ApplyTagResult(added, removed, failed);
    }

    private static string[] WithTag(string[] tags, string tag, bool add)
    {
        var without = tags.Where(t => !string.Equals(t, tag, StringComparison.OrdinalIgnoreCase));
        return (add ? without.Append(tag) : without).ToArray();
    }

    private static async Task SaveAsync(BaseItem item, CancellationToken cancellationToken)
    {
        item.OnMetadataChanged();

        // MetadataEdit, as the metadata editor uses: also runs the metadata savers (NFO etc.)
        await item.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, cancellationToken).ConfigureAwait(false);
    }

    private async Task SetTagAsync(BaseItem item, string tag, bool add, CancellationToken cancellationToken)
    {
        var hasTag = item.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase);
        if (hasTag != add)
        {
            // The item's own tags change even when locked: the lock only stops metadata
            // providers, as in the metadata editor
            item.Tags = WithTag(item.Tags, tag, add);
            await SaveAsync(item, cancellationToken).ConfigureAwait(false);
            _logger.LogInformation("QuickTag: {Action} tag {Tag} on {Item}", add ? "added" : "removed", tag, item.Name);
        }

        // Like the metadata editor, a series' or season's tags carry down to its seasons and
        // episodes (unless their tags are locked), so tag filters find the episodes too.
        // Done even when the item itself didn't change, to repair children left behind
        IEnumerable<BaseItem> children = item switch
        {
            Series series => series.Children.OfType<Season>()
                .SelectMany(s => s.Children.OfType<Episode>().Cast<BaseItem>().Prepend(s)),
            Season season => season.Children.OfType<Episode>(),
            _ => [],
        };

        foreach (var child in children)
        {
            if (child.LockedFields.Contains(MetadataField.Tags)
                || child.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase) == add)
            {
                continue;
            }

            child.Tags = WithTag(child.Tags, tag, add);
            await SaveAsync(child, cancellationToken).ConfigureAwait(false);
        }
    }
}
