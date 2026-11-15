namespace Jellyfin.Plugin.QuickTag.Injection;

/// <summary>
/// Callback the File Transformation plugin calls each time it serves index.html.
/// </summary>
public static class IndexTransformer
{
    /// <summary>
    /// Adds the script tag to index.html. Found by name through reflection: keep the
    /// class and method names in step with <see cref="ScriptInjector"/>.
    /// </summary>
    /// <param name="payload">The file's current contents.</param>
    /// <returns>The new contents.</returns>
    public static string TransformIndex(TransformPayload payload)
    {
        return IndexHtmlPatcher.Patch(payload?.Contents ?? string.Empty);
    }
}
