// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

using Azure;
using Azure.AI.OpenAI;
using WeatherAgentAssistive;
using WeatherAgentAssistive.Agent;
using WeatherAgentAssistive.Tools;
using Microsoft.Agents.Builder;
using Microsoft.Agents.Hosting.AspNetCore;
using Microsoft.Agents.Storage;
using Microsoft.Extensions.AI;

var builder = WebApplication.CreateBuilder(args);

// Bind to the configured port before any other port is attempted
var port = builder.Configuration["PORT"] ?? "3981";
builder.WebHost.UseUrls($"http://localhost:{port}");

builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();
builder.Logging.AddConsole();

builder.Services.AddAuthentication();
builder.Services.AddAuthorization();
builder.Services.AddAgentAspNetAuthentication(builder.Configuration);

builder.Services.AddSingleton<IStorage, MemoryStorage>();

builder.AddAgentApplicationOptions();

builder.AddAgent<WeatherAgentApp>();

var aoaiEndpoint = builder.Configuration["AzureOpenAI:Endpoint"]!;
var aoaiKey = builder.Configuration["AzureOpenAI:ApiKey"]!;
builder.Services.AddSingleton(new AzureOpenAIClient(new Uri(aoaiEndpoint), new AzureKeyCredential(aoaiKey)));

builder.Services.AddSingleton<IChatClient>(sp =>
{
    var aoai = sp.GetRequiredService<AzureOpenAIClient>();
    var deployment = builder.Configuration["AzureOpenAI:Deployment"] ?? "gpt-4o";
    return aoai.GetChatClient(deployment)
               .AsIChatClient()
               .AsBuilder()
               .UseFunctionInvocation()
               .Build();
});

builder.Services.AddSingleton<WeatherLookupTool>();

var app = builder.Build();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "healthy",
    timestamp = DateTimeOffset.UtcNow
}));

app.MapPost("/api/messages", async (HttpRequest request, HttpResponse response, IAgentHttpAdapter adapter, IAgent agent, CancellationToken ct) =>
{
    await adapter.ProcessAsync(request, response, agent, ct);
});

if (app.Environment.IsDevelopment())
{
    app.MapGet("/", () => "WeatherAgentAssistive — dotnet + Agent Framework assistive agent");
}

app.Run();
