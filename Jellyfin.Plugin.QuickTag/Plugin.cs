using System;
using Jellyfin.Plugin.QuickTag.Configuration;
using Jellyfin.Plugin.QuickTag.Injection;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.QuickTag;

/// <summary>
/// QuickTag: bulk tag editing from the Jellyfin web client.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    private readonly IApplicationPaths _applicationPaths;
    private readonly ILogger<Plugin> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">The server's application paths.</param>
    /// <param name="xmlSerializer">The XML serializer.</param>
    /// <param name="logger">The logger.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        _applicationPaths = applicationPaths;
        _logger = logger;
    }

    /// <inheritdoc />
    public override string Name => "QuickTag";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("1746460b-89cc-4a19-869e-82e4ea79f6fd");

    /// <inheritdoc />
    public override string Description => "Add and remove tags on many titles quickly, right from the library views.";

    /// <inheritdoc />
    public override void OnUninstalling()
    {
        // Undo the direct index.html patch, if the fallback injection made one
        IndexHtmlPatcher.TryUnpatch(_applicationPaths.WebPath, _logger);
        base.OnUninstalling();
    }
}
