namespace Jellyfin.Plugin.QuickTag.Injection;

/// <summary>
/// What File Transformation passes to <see cref="IndexTransformer.TransformIndex"/>:
/// JSON <c>{"contents": "..."}</c>, bound case-insensitively.
/// </summary>
public class TransformPayload
{
    /// <summary>
    /// Gets or sets the file's contents.
    /// </summary>
    public string? Contents { get; set; }
}
