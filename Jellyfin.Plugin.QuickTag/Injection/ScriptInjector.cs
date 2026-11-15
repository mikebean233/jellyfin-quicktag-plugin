using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.QuickTag.Injection;

/// <summary>
/// Loads QuickTag's script into jellyfin-web at startup: through the File Transformation
/// plugin when it is installed (changes the served page, never the files), otherwise by
/// patching index.html on disk where that is writable.
/// </summary>
public class ScriptInjector : IHostedService
{
    private const string FileTransformationAssembly = "Jellyfin.Plugin.FileTransformation";

    // This plugin's transformation id: a fixed GUID, so a restart replaces rather than adds
    private static readonly Guid _transformationId = Guid.Parse("4b0d1f3e-5c55-4d47-9c1e-6f7f2b2e9a11");

    private readonly IApplicationPaths _applicationPaths;
    private readonly ILogger<ScriptInjector> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ScriptInjector"/> class.
    /// </summary>
    /// <param name="applicationPaths">The server's application paths.</param>
    /// <param name="logger">The logger.</param>
    public ScriptInjector(IApplicationPaths applicationPaths, ILogger<ScriptInjector> logger)
    {
        _applicationPaths = applicationPaths;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (TryRegisterWithFileTransformation())
        {
            _logger.LogInformation("QuickTag: web script registered with File Transformation");

            // Drop an earlier direct patch, or the page would load the script twice
            IndexHtmlPatcher.TryUnpatch(_applicationPaths.WebPath, _logger);
        }
        else if (IndexHtmlPatcher.TryPatch(_applicationPaths.WebPath, _logger))
        {
            _logger.LogInformation("QuickTag: File Transformation not installed; added the web script to index.html directly");
        }
        else
        {
            _logger.LogWarning(
                "QuickTag: could not load the web script. Install the File Transformation plugin "
                + "(repository https://www.iamparadox.dev/jellyfin/plugins/manifest.json) and restart");
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private bool TryRegisterWithFileTransformation()
    {
        // File Transformation lives in its own load context, so it is called by reflection,
        // with its own copy of Newtonsoft's JObject built from JSON text
        var assembly = AssemblyLoadContext.All
            .SelectMany(context => context.Assemblies)
            .FirstOrDefault(a => a.GetName().Name == FileTransformationAssembly);
        var register = assembly?.GetType(FileTransformationAssembly + ".PluginInterface")?.GetMethod("RegisterTransformation");
        var payloadType = register?.GetParameters().SingleOrDefault()?.ParameterType;
        var parse = payloadType?.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, [typeof(string)]);
        if (register is null || parse is null)
        {
            if (assembly is not null)
            {
                _logger.LogWarning("QuickTag: this File Transformation version has no RegisterTransformation(JObject)");
            }

            return false;
        }

        var json = JsonSerializer.Serialize(new
        {
            id = _transformationId,
            fileNamePattern = "index.html",
            callbackAssembly = typeof(IndexTransformer).Assembly.FullName,
            callbackClass = typeof(IndexTransformer).FullName,
            callbackMethod = nameof(IndexTransformer.TransformIndex),
        });

        try
        {
            register.Invoke(null, [parse.Invoke(null, [json])]);
            return true;
        }
        catch (TargetInvocationException ex)
        {
            _logger.LogError(ex.InnerException ?? ex, "QuickTag: File Transformation registration failed");
            return false;
        }
    }
}
