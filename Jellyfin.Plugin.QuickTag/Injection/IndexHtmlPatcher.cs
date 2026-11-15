using System;
using System.IO;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.QuickTag.Injection;

/// <summary>
/// Adds QuickTag's script tag to jellyfin-web's index.html.
/// </summary>
public static class IndexHtmlPatcher
{
    private const string StartMarker = "<!-- QuickTag start -->";
    private const string EndMarker = "<!-- QuickTag end -->";

    /// <summary>
    /// Gets the script tag. Relative, so it works under any base URL: index.html is served
    /// from {base}/web/, the script from {base}/QuickTag/ClientScript.
    /// </summary>
    private static string ScriptTag =>
        $"{StartMarker}<script defer src=\"../QuickTag/ClientScript?v={typeof(Plugin).Assembly.GetName().Version}\"></script>{EndMarker}";

    /// <summary>
    /// Returns index.html with the script tag added (replacing an older one).
    /// </summary>
    /// <param name="html">index.html's contents.</param>
    /// <returns>The patched contents.</returns>
    public static string Patch(string html)
    {
        ArgumentNullException.ThrowIfNull(html);

        var clean = Unpatch(html);
        var bodyEnd = clean.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return bodyEnd < 0 ? clean + ScriptTag : clean.Insert(bodyEnd, ScriptTag);
    }

    /// <summary>
    /// Returns index.html without the script tag.
    /// </summary>
    /// <param name="html">index.html's contents.</param>
    /// <returns>The contents without QuickTag.</returns>
    public static string Unpatch(string html)
    {
        ArgumentNullException.ThrowIfNull(html);

        var start = html.IndexOf(StartMarker, StringComparison.Ordinal);
        var end = html.IndexOf(EndMarker, StringComparison.Ordinal);
        return start >= 0 && end > start ? html.Remove(start, end + EndMarker.Length - start) : html;
    }

    /// <summary>
    /// Patches index.html on disk. Fails when the web folder is read-only, as in most containers.
    /// </summary>
    /// <param name="webPath">The jellyfin-web folder.</param>
    /// <param name="logger">The logger.</param>
    /// <returns>Whether the file now loads the script.</returns>
    public static bool TryPatch(string webPath, ILogger logger)
    {
        return Rewrite(webPath, logger, Patch);
    }

    /// <summary>
    /// Removes the script tag from index.html on disk, if it is there.
    /// </summary>
    /// <param name="webPath">The jellyfin-web folder.</param>
    /// <param name="logger">The logger.</param>
    public static void TryUnpatch(string webPath, ILogger logger)
    {
        Rewrite(webPath, logger, Unpatch);
    }

    private static bool Rewrite(string webPath, ILogger logger, Func<string, string> change)
    {
        var path = Path.Combine(webPath, "index.html");
        try
        {
            if (!File.Exists(path))
            {
                logger.LogWarning("QuickTag: {Path} not found", path);
                return false;
            }

            var html = File.ReadAllText(path);
            var changed = change(html);
            if (!string.Equals(html, changed, StringComparison.Ordinal))
            {
                File.WriteAllText(path, changed);
            }

            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning("QuickTag: can't write {Path} ({Message})", path, ex.Message);
            return false;
        }
    }
}
