var g_ResultsJsonContents = "";
var g_ScoresJsonContents = "";
var g_MatchDefJsonContents = "";

const psd_script = document.createElement("script");

psd_script.textContent = `
(function() {
    var psd_results = window.results;
    var psd_scores = window.scores;
    var psd_matchdef = window.matchDef;

    window.dispatchEvent(new CustomEvent('resultsFetched', { detail: psd_results }));
    window.dispatchEvent(new CustomEvent('scoresFetched', { detail: psd_scores }));
    window.dispatchEvent(new CustomEvent('matchDefFetched', { detail: psd_matchdef }));

    window.dispatchEvent(new CustomEvent('psd_finalized', { detail: null }));
})();
`;

function downloadFile(filename, content, mimeType = 'text/json') {
    // Create a Blob containing the content
    const blob = new Blob([content], { type: mimeType });
    // Create a temporary URL for the Blob
    const url = URL.createObjectURL(blob);
  
    // Create an anchor element and set its download attribute
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
  
    // Append the anchor to the document, trigger the download, and remove it
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  
    // Clean up the temporary URL
    URL.revokeObjectURL(url);
  }

  function get_ps_name()
{
    var ps_name = "";
    const header_div = document.getElementById("resultsBaseHolder");
    if (header_div)
    {
        const h4_element = header_div.querySelector("h4");
        const small_element = header_div.querySelector("small");

        if (h4_element)
            ps_name = ps_name + h4_element.textContent;
    }
    else
    {
        const cur_date = new Date();
        const year = cur_date.getFullYear();
        const month = cur_date.getMonth + 1;
        const day = cur_date.getDate();

        ps_name = "NO_NAME-${day}-${month}-${year}";
    }

    ps_name = ps_name.replace(/[\r\n]+/g, ' ').trim();

    ps_name = ps_name.replace(/(\r\n|\n|\r)/gm, '');

    ps_name = ps_name.replace(/[\r\n]+/g, ' ').trim();

    ps_name = ps_name.replace(/[\/\\?%*:|"<>]/g, '');

    ps_name = ps_name.replace(/[\r\n]+/g, ' ').trim();

    return ps_name;
}

function download_results_function()
{
    // alert( get_ps_name() + "_results.json");

    downloadFile(get_ps_name() + "_results.json", g_ResultsJsonContents);
}

function download_scores_function()
{
    downloadFile(get_ps_name() + "_scores.json", g_ScoresJsonContents);
}

function download_match_def_function()
{
    downloadFile(get_ps_name() + "_matchDef.json", g_MatchDefJsonContents);
}

window.addEventListener('resultsFetched', function(e)
{
    if (e.detail == null)
        return;

    g_ResultsJsonContents = JSON.stringify(e.detail, null, "\t");
});

window.addEventListener('scoresFetched', function(e)
{
    if (e.detail == null)
        return;

    g_ScoresJsonContents = JSON.stringify(e.detail, null, "\t")
});

window.addEventListener('matchDefFetched', function(e)
{
    if (e.detail == null)
        return;

    g_MatchDefJsonContents = JSON.stringify(e.detail, null, "\t")

});

window.addEventListener("psd_finalized", function(e)
{

    const navbar_ul = document.querySelector("ul.navbar-nav");

    if (!g_ResultsJsonContents || !g_ScoresJsonContents || !g_MatchDefJsonContents)
    {
        
    
        if (navbar_ul)
        {
            const no_results = document.createElement("li")
            no_results.textContent = "PSD: No Results Detected";
    
            navbar_ul.appendChild(no_results);
        }
    }
    else
    {
        if (navbar_ul)
        {
            const download_results_button = document.createElement('button');
            download_results_button.textContent = "Download Results";
            download_results_button.addEventListener("click", download_results_function);
    
            const download_scores_button = document.createElement("button");
            download_scores_button.textContent = "Download Scores";
            download_scores_button.addEventListener("click", download_scores_function);
    
            const download_match_def_button = document.createElement("button");
            download_match_def_button.textContent = "Download Match Def";
            download_match_def_button.addEventListener("click", download_match_def_function);
    
            const download_results_item = document.createElement('li');
            download_results_item.appendChild(download_results_button);
            
            const download_scores_item = document.createElement("li");
            download_scores_item.appendChild(download_scores_button);
    
            const download_match_def_item = document.createElement("li");
            download_match_def_item.appendChild(download_match_def_button);
    
            navbar_ul.appendChild(download_results_item);
            navbar_ul.appendChild(download_scores_item);
            navbar_ul.appendChild(download_match_def_item);
        }
    }
});


(document.head || document.documentElement).appendChild(psd_script);
psd_script.remove();

// document.body.style.border = "5px solid red";

